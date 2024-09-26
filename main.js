const puppeteer= require('puppeteer-core');
const path = require('path');
const { app, BrowserWindow, ipcMain, dialog } = require('electron/main');
const fs = require('node:fs');
const {shell} = require('electron');

//headless : true = 브라우저 안보임, false = 브라우저 보임
const HEADLESS = false;

const FILE_NAME = "./board.json"

/**
 * browser
 *     assign 시점 = ipcMain.on("did-finish-init")
 *     close 시점 = app quit
 * pf---문자열
 *     게시판 플랫폼. 카페 또는 라운지(게임)
 * board_url -> json 배열
 *     assign 시점 = createwindow()
 */
let obj = { browser:0, pf:0, board_url:[]};

/**
 * browser launch 이후 해당 url에 접속
 * 플랫폼 인식
 * @param {String} url 
 * @returns 
 */
async function accessPage(url) {
  console.log("==== start create new page and access url: ", url);

  const page = await obj.browser.newPage();
  await page.goto(url);
  if(HEADLESS == false) await page.setViewport({width:1200, height:700});

  if(url.includes("cafe.naver.com")){
    await page.waitForSelector('#cafe_main'); //iframe 기다리기. iframe 하위 정보는 일반적으로 접근 못함
    obj.pf = "cafe";
  }
  else if(url.includes("game.naver.com")){
    await page.waitForSelector('#panelCenter > div > div.article_board_table_wrap__2X8Or > table > tbody > tr:nth-child(1) > td:nth-child(1) > div > a');
    obj.pf = "game";
  }
  else{
    console.log("wrong platform url", url);
    throw new Error("WRONG_URL");
  }

  console.log("== platform ==", obj.pf);
  console.log("done");

  return page;
}

/**
 * 해당 페이지에서 게시글 제목, 작성자, 작성일 크롤링
 * @param {puppeteer.Page} page 
 * @returns 
 */
async function getPostsData(page){
  console.log("==== start get post data");
  
  let result = [];

  if(obj.pf == "cafe"){
    /*----카페
    일반글                                공지글
    #main-area > div:nth-child(4) > ~~    #main-area > div:nth-child(3) > ~~
    */
    let e_handle = await page.$('iframe#cafe_main');
    const iframe = await e_handle.contentFrame();

    // 제목, url
    e_handle = await iframe.$$('#main-area > div:nth-child(4) > table > tbody > tr > td.td_article > div.board-list > div > a.article');

    if(e_handle.length == 0) throw new Error("CAFE_POSTDATA");
    
    for (let element of e_handle){
      const title = await element.evaluate(e => e.textContent.trim().replace(/\s+/g,' '));
      const url = await element.evaluate(e => e.href);

      result.push({
          title: title,
          url: url
        });
    }

    // 작성자
    e_handle = await iframe.$$('#main-area > div:nth-child(4) > table > tbody > tr > td.td_name > div > table > tbody > tr > td > a');

    for(let i=0; i<result.length; i++){
      result[i].author = await e_handle[i].evaluate(e => e.textContent.trim());
    }

    // 작성일
    e_handle = await iframe.$$('#main-area > div:nth-child(4) > table > tbody > tr > td.td_date');

    for(let i=0; i<result.length; i++){
      result[i].date = await e_handle[i].evaluate(e => e.textContent.trim());
    }
  }
  else if(obj.pf == "game"){
    /*----라운지
      가장 하위 a 태그 바로 위 div에 ::before가 있으면 공지글, 없으면 일반글
    */
    let e_handle_array = await page.$$('#panelCenter > div > div.article_board_table_wrap__2X8Or > table > tbody > tr > td:nth-child(1) > div');

    if(e_handle_array.length == 0) throw new Error("GAME_POSTDATA");

    // ::before 유무 분류
    let start_normal = 0;
    for(let e_handle of e_handle_array){
      const hasBefore = await page.evaluate(e => {
        const before = window.getComputedStyle(e, '::before');
        return before.content !== 'none';
      }, e_handle);

      if(hasBefore){
        start_normal += 1;
      }
      else{
        break;
      }
    }

    // 제목, url
    e_handle_array = await page.$$('#panelCenter > div > div.article_board_table_wrap__2X8Or > table > tbody > tr > td:nth-child(1) > div > a');

    const len = Object.keys(e_handle_array).length;
    for(let i=start_normal; i<len; i++){
      const title = await e_handle_array[i].evaluate(e => e.textContent.trim());
      const url = await e_handle_array[i].evaluate(e=>e.href);

      result.push({
        title: title,
        url: url
      });
    }

    await page.waitForSelector('#panelCenter > div > div.article_board_table_wrap__2X8Or > table > tbody > tr > td:nth-child(2) > div > span > span > span');
    //작성자
    e_handle_array = await page.$$('#panelCenter > div > div.article_board_table_wrap__2X8Or > table > tbody > tr > td:nth-child(2) > div > span > span > span');
    
    for(let i=start_normal; i<len; i++){
      const temp = await e_handle_array[i].evaluate(e=>e.textContent.trim());
      result[i-start_normal].author = temp;
    }

    //작성일
    await page.waitForSelector('#panelCenter > div > div.article_board_table_wrap__2X8Or > table > tbody > tr > td:nth-child(3) > span');
    e_handle_array = await page.$$('#panelCenter > div > div.article_board_table_wrap__2X8Or > table > tbody > tr > td:nth-child(3) > span');

    for(let i=start_normal; i<len; i++){
      result[i-start_normal].date = await e_handle_array[i].evaluate(e=>e.textContent.trim());
    }
  }

  console.log("post count:", result.length);
  console.log("done");
  return result;
}

/**
 * 해당 페이지의 대표 이미지 경로 크롤링
 * @param {puppeteer.Page} page 
 * @returns 
 */
async function getThumbImgSrc(page){
  console.log("==== start get thumbnail image src");

  let result;
  let e_handle;
  let img_src;
  if(obj.pf == 'cafe'){
    try{
      e_handle = await page.$('#ia-info-data > ul > li:nth-child(1) > a > img');
    }catch(error){
      throw new Error("CAFE_IMGSRC");
    }
  }
  else if(obj.pf == 'game'){
    let typ = 1;
    try{
      await page.waitForSelector("#lnb > div.header_wrap__2X1jy.header_bottom_gradient__aZsW5 > div > div.header_container-wrapper__area__36Ond > img");
    }catch(err){
      //치지직 라운지 때문
      //page.url() 하면 현재 페이지의 url 알 수 있음
      try{
        await page.waitForSelector('#lnb > div.header_wrap__2X1jy > div > div.header_container-wrapper__area__36Ond > img');
      }catch(err){
        throw new Error("GAME_IMGSRC");
      }
      typ = 2;
    }

    switch(typ){
      case 1:
        e_handle = await page.$("#lnb > div.header_wrap__2X1jy.header_bottom_gradient__aZsW5 > div > div.header_container-wrapper__area__36Ond > img");
        break;
      case 2:
        e_handle = await page.$('#lnb > div.header_wrap__2X1jy > div > div.header_container-wrapper__area__36Ond > img');
        break;
    }
  }

  img_src = await e_handle.getProperty('src');
  result = await img_src.jsonValue();

  if(obj.pf == 'cafe'){
    result = result.split("?")[0];
  }
  else if(obj.pf == 'game'){

  }

  console.log("img src: ", result);
  console.log("done");
  return result;
}

/**
 * 해당 페이지 하단에 보여지는 페이지 번호 데이터 크롤링
 * @param {puppeteer.Page} page 
 * @param {Number} order 
 * @returns 
 */
async function getPageNum(page, order){
  console.log("==== start get page number array");

  let result = [];
  if(obj.pf == 'cafe'){
    const e_handle = await page.$('iframe#cafe_main');
    const iframe = await e_handle.contentFrame();

    const e_handle_array = await iframe.$$('#main-area > div.prev-next > a');
    for (let e_handle of e_handle_array){
      const _num = await e_handle.evaluate(e => e.textContent.trim());
      const _url = await e_handle.evaluate(e => e.href);

      result.push({
        num: _num,
        url: _url
      });
    }
  }
  else if(obj.pf == 'game'){
    // 네이버 게임 페이지 번호는 이전, 다음 페이지를 js로 동적으로 표현
    // 또한 버튼에 링크가 걸려있지 않아서 직접 링크를 만들어서 접근해야함
    // 따라서
    // 1. 먼저 번호 버튼의 텍스트를 가져옴(숫자, 전 페이지)
    // 2. 각 텍스트에 올바른 텍스트를 부여 및 링크 제작
    const e_handle_array = await page.$$('#panelCenter > div > div.article_pagination__1zHUl > button');
    for(let e_handle of e_handle_array){
      const _num = await e_handle.evaluate(e => e.textContent.trim());

      result.push({
        num: _num,
        url: 0
      })
    }

    // 페이지 링크가 각 게임 로비? 링크에 추가적으로 덧붙힌 형식
    let url_template = obj.board_url[order].url;

    for(let i=0; i<result.length; i++){
      if(i==0 && result[i].num=="전 페이지"){
        result[i].num = "이전";
        result[i].url = url_template + `?page=${Number(result[i+1].num)-1}&order=new`;
      }
      else if(i==result.length-1 && result[i].num=="전 페이지"){
        result[i].num = "다음";
        result[i].url = url_template + `?page=${Number(result[i-1].num)+1}&order=new`;
      }
      else{
        result[i].url = url_template + `?page=${Number(result[i].num)}&order=new`;
      }
    }
  }

  //console.log("page num: ", result.map(object => object.num));
  //console.log("page url: ", result.map(object => object.url));
  console.log("done");
  return result;
}

/**
 * 해당 페이지의 게시판 이름과 브랜드 이름 크롤링
 * @param {puppeteer.Page} page 
 * @returns 
 */
async function getInfo(page){
  console.log("==== start get brand name and board title");

  let result;

  if(obj.pf == 'cafe'){
    let e_handle = await page.$('#cafe-body > footer > h2.cafe_name');
    const brand_name = await e_handle.evaluate(e => e.textContent.trim());

    e_handle = await page.$('iframe#cafe_main');
    const iframe = await e_handle.contentFrame();
    const i_handle = await iframe.$('#sub-tit > div.title_area > div > h3');
    const board_title = await i_handle.evaluate(e => e.textContent.trim());

    result = {
      brand: brand_name,
      board: board_title
    };
  }
  else if(obj.pf == 'game'){
    let e_handle = await page.$('#lnb > div.header_wrap__2X1jy.header_bottom_gradient__aZsW5 > div > div.header_container-wrapper__area__36Ond > div > h2 > a');
    //치지직...
    if(e_handle == null) e_handle = await page.$('#lnb > div.header_wrap__2X1jy > div > div.header_container-wrapper__area__36Ond > div > h2 > a');
    const brand_name = await e_handle.evaluate(e => e.textContent.trim());

    e_handle = await page.$('#panelCenter > div > div.article_board_title_area__S_a6b > strong');
    const board_title = await e_handle.evaluate(e => e.textContent.trim());

    result = {
      brand: brand_name,
      board: board_title
    };
  }

  console.log("brand name:",result.brand);
  console.log("board title:",result.board);
  console.log("done");

  return result;
}

/**
 * 게시판 번호(파라미터)를 받아서 해당 게시판 페이지에 접근해서 모든 정보를 크롤링
 * @param {Number} _order 
 * @returns 
 */
async function getWebPageInfo(_order){
  _order = Number(_order);
  console.log("order:", _order);
  let result = {};
  try{
  const page = await accessPage(obj.board_url[_order].url);
  result.info = await getInfo(page);
  result.page = await getPageNum(page, _order);
  result.post = await getPostsData(page);
  }catch(error){
    console.log("ERROR - get web page info");
    console.log(error)
  }

  return result;
}

/**
 * 브라우저의 활성화 페이지 최소한으로 유지.
 * black 페이지만 살아있도록 함.
 */
async function deletePage(){
  const pages = await obj.browser.pages();
  // log...
  for(let i=1; i<pages.length; i++){
    await pages[i].close();
  }
  // log...
}

/**
 * 브라우저 실행
 */
async function launchBrowser() {
  try{
    //dir /s \chrome.exe /b   childprocess exec
    obj.browser = await puppeteer.launch({
      headless: HEADLESS,
      executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
      userDataDir: "./User Data"
    });
  } catch(err){
    console.log("browser launch error");
    console.log(err);

    dialog.showMessageBoxSync(app.win, {
      message: "chrome이 없거나 경로가 잘못됨",
      button: ['ok']
    }).then(result => {
      if(result.response === 0){
        console.log("ok clicked");
        app.quit();
      }
    })
  }

  console.log("success assign broswer");
  console.log("browser info: ", obj.browser);
}

// 일렉트론 초기 첫 세팅
// 이 과정에서 비동기 함수를 실행하면 원하는 동작을 만들 수 없음
// 비동기(puppeteer)와 동기적 실행을 분리.
// async createWindow를 하게 되면 BrowserWindow의 일부 함수가 동작하지 않고 다음으로 넘어감.
function createWindow (){
  console.time("----time");
  console.log("==== start create electron window");

  let file_exist = true;
  try{
    fs.accessSync(FILE_NAME, fs.constants.F_OK);
  }catch(error){
    console.log("file no exist");
    file_exist = false;
  }

  if(file_exist){
    const file_data = fs.readFileSync(FILE_NAME,'utf8');
    let json_data = JSON.parse(file_data);
    obj.board_url = json_data;

    console.log("json data length:", obj.board_url.length);
  }

  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(path.resolve(), 'preload.js'),
      nodeIntegration: true,
      contextIsolation: false,
    }
  })

  win.loadFile('index.html');

  // webContent 이벤트는 상위 흐름이 동기적이어야 동작함.
  // create window가 async이면 동작 안한다는 얘기.
  win.webContents.on('did-finish-load',(event) => {
    win.webContents.send("json-data", obj.board_url);
  })

  console.timeEnd("----time");
  console.log("done\n");
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  })
})

app.on('window-all-closed', async() => {
  if (process.platform !== 'darwin') {
    if(obj.browser != 0) await obj.browser.close();
    app.quit();
  }
})

// 프로그램이 준비가 안료된 후 render -> main으로 이벤트를 발생시켜 puppeteer 시작
ipcMain.on("did-finish-init", async(event, args) => {
  console.time("----time");
  console.log("==== finish initialize electron ====");
  console.log("==== start crawling website thumbnail img src");
  
  if(obj.browser == 0) await launchBrowser();

  const result = await getWebPageInfo(0);

  event.reply("page-info", result);

  console.timeEnd("----time");
  console.log("done\n");
})

// 페이지 버튼 눌러서 새로운 페이지 정보 크롤링 및 데이터 전송
// 응답 전송 channel - "result-new-page"
ipcMain.on("load-new-page", async (event, args) => {
  console.time("----time");
  console.log("==== start new webpage crawling");

  const [num, page_url, board_order] = args;
  console.log("request num:",num, " url: ",page_url," board-order: ", board_order);

  let result = {};
  //크롤링
  const page = await accessPage(page_url);
  result.page = await getPageNum(page, board_order);
  result.post = await getPostsData(page);

  const page_num = /page=[0-9]{1,2}/g.exec(page_url)[0].split("=")[1];
  result.present_page = page_num;

  await deletePage();

  //새로운 페이지 데이터 전송
  event.reply("result-new-page", result);
  console.timeEnd("----time");
  console.log("done\n");
})

// 버튼을 눌러서 게시판을 바꿔야함
ipcMain.on("load-new-board", async(event, args) =>{
  console.time("----time");
  console.log("==== start new board crawling");
  
  const result = await getWebPageInfo(args);

  await deletePage();

  //게시판 글 목록 데이터 전송
  event.reply("page-info", result);
  console.timeEnd("----time");
  console.log("done\n");
})

// 글 링크를 접속하는 것은 설치된 로컬 브라우저에서 접속
ipcMain.on("new-window", (event, args)=>{
  console.log("open url in local browser");

  shell.openExternal(args); // 로컬 기본 브라우저로 링크 열기
  console.log("done\n");
})

// 추가한 url에 접속해서 대표이미지 경로 가져오기 및 json 파일 저장
ipcMain.on("add-board", async(event, args)=>{
  console.log("add new board information");

  if(obj.browser == 0) await launchBrowser();

  let img_src;
  try{
    const page = await accessPage(args.url);
    img_src = await getThumbImgSrc(page);
    await getPostsData(page);
  }catch(error){
    console.log("getThnmbImgSrc error");
    console.log(error);

    dialog.showMessageBoxSync(app.win, {
      message: `잘못된 url입니다. ${error}`,
      button: ['ok']
    });
    
    return;
  }

  obj.board_url.push({
    name: args.name,
    order: obj.board_url.length,
    url: args.url,
    src: img_src
  })

  const data = JSON.stringify(obj.board_url, null, "\t");

  fs.writeFile(FILE_NAME, data, err => {
    if (err) {
      console.error(err);
    }
  });

  dialog.showMessageBoxSync(app.win, {
    message: "프로그램을 재시작해야 합니다.",
    button: ['ok']
  });
})

/* 크롤링 시작 후
1. main은 플랫폼마다 다른 데이터를 가공
2. render는 데이터 받아서 단순 렌더링

//  -- ipc data format
// 게시판 버튼 생성용 데이터
//     json 파일 데이터 그대로 사용

// 크롤링 데이터
{
  info:{ brand:"", board:"" },  // 페이지 바꿀때는 안넘김
  page:[
    {
      num:"~~",
      url:"~~"
    },
    ...],
  post:[
    {
      title:"~~",
      url:"~~",
      author:"~~",
      date:"~~"
    },
    ...],
  present_page: "~~"
}
*/
