const puppeteer= require('puppeteer-core');
const path = require('path');
const { app, BrowserWindow, ipcMain, dialog } = require('electron/main');
const fs = require('node:fs');
const {shell} = require('electron');

//headless : true = 브라우저 안보임, false = 브라우저 보임
const HEADLESS = true;

/**
 * browser
 *     assign 시점 = ipcMain.on("did-finish-init")
 *     close 시점 = app quit
 * pf---문자열
 *     게시판 플랫폼. 카페 또는 라운지(게임)
 * board_url---배열
 *     assign 시점 = createwindow read board.json file
 */
let obj = { browser:0, pf:0, board_url:0};

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
    await page.waitForSelector('#panelCenter > div > div.article_board_table_wrap__2X8Or > table > tbody > tr:nth-child(13) > td:nth-child(1) > div > a');
    obj.pf = "game";
  }

  console.log("== platform ==", obj.pf);
  console.log("done");

  return page;
}

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

async function getThumbImgSrc(page){
  console.log("==== start get thumbnail image src");

  let result;
  let e_handle;
  let img_src;
  if(obj.pf == 'cafe'){
    e_handle = await page.$('#ia-info-data > ul > li:nth-child(1) > a > img');
  }
  else if(obj.pf == 'game'){
    await page.waitForSelector("#lnb > div.header_wrap__2X1jy.header_bottom_gradient__aZsW5 > div > div.header_container-wrapper__area__36Ond > img");
    e_handle = await page.$("#lnb > div.header_wrap__2X1jy.header_bottom_gradient__aZsW5 > div > div.header_container-wrapper__area__36Ond > img");
  }

  img_src = await e_handle.getProperty('src');
  result = await img_src.jsonValue();

  console.log("img src: ", result);
  console.log("done");
  return result;
}

/**
 * 해당 페이지 하단에 보여지는 페이지 번호 데이터 크롤링
 * @param {*} page 
 * @param {*} order 
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
 * @param {*} page 
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
 * @param {*} _order 
 * @returns 
 */
async function getWebPageInfo(_order){
  _order = Number(_order);
  console.log("order:", _order);
  let result = {};
  const page = await accessPage(obj.board_url[_order].url);

  result.info = await getInfo(page);
  result.page = await getPageNum(page, _order);
  result.post = await getPostsData(page);

  return result;
}

async function deletePage(){
  const pages = await obj.browser.pages();
  // log...
  for(let i=1; i<pages.length; i++){
    await pages[i].close();
  }
  // log...
}

// 일렉트론 초기 첫 세팅
// 이 과정에서 비동기 함수를 실행하면 원하는 동작을 만들 수 없음
// 비동기(puppeteer)와 동기적 실행을 분리.
// async createWindow를 하게 되면 BrowserWindow의 일부 함수가 동작하지 않고 다음으로 넘어감.
function createWindow (){
  console.time("----time");
  console.log("==== start create electron window");

  let  file_data;
  // 파일 없으면 알려주기 위해 에러 발생
  try{
    file_data = fs.readFileSync('./board.json','utf8');
  }catch(err){
    console.error(err);
    throw err;
    return;
  }
  let json_data = JSON.parse(file_data);

  console.log("json data length:", json_data.length);
  obj.board_url = json_data;

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
  /*
  win.webContents.on('did-finish-load', (event) => {
    console.log("==== event ==== did-finish-load");
    win.webContents.send('json-data', obj.board_url);
  });

  win.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.log("==== event ==== did-fail-load");
    console.error("Error code:", errorCode);
    console.error('Failed to load file:', errorDescription);
  });
  */
  console.timeEnd("----time");
  console.log("done\n");
}

app.whenReady().then(() => {
  // json 파일이 없을 때 알려주고 앱 종료
  try{
    createWindow();
  }catch(err){
    dialog.showMessageBoxSync(app.win, {
      message: "json file이 없음",
      button: ['ok']
    }).then(result => {
      if(result.response === 0){
        console.log("ok clicked");
        app.quit();
      }
    })
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      try{
        createWindow();
      }catch(err){
        dialog.showMessageBoxSync(app.win, {
          message: "json file이 없음",
          button: ['ok']
        }).then(result => {
          if(result.response === 0){
            console.log("ok clicked");
            app.quit();
          }
        })
      }
    }
  })
})

app.on('window-all-closed', async() => {
  if (process.platform !== 'darwin') {
    await obj.browser.close();
    app.quit();
  }
})

//어떻게 해도 비동기 함수를 동기적 흐름으로 만들 수 없음
//따라서 createwindow와 같은 초기 프로그램 세팅 되는 과정에서 비동기적 흐름을 제어해서 동기적으로 만드는 것은 불가능 하다고 판단
//프로그램이 준비가 안료된 후 render -> main으로 이벤트를 발생시켜 강제로 비동기적 흐름으로 프로그램 제어
ipcMain.on("did-finish-init", async(event, args) => {
  console.time("----time");
  console.log("==== finish initialize electron ====");
  console.log("==== start crawling website thumbnail img src");

  try{//dir /s \chrome.exe /b   childprocess exec
    obj.browser = await puppeteer.launch({ headless: HEADLESS, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe"});
  } catch(err){
    console.log("browser launch error");
    console.log(err);
    return;
  }

  console.log("success assign broswer");
  console.log("browser info: ", obj.browser);

  let res = [];

  //저장된 모든 웹페이지에 접근해서 대표 이미지 가져오기
  for(let i=0; i<obj.board_url.length; i++){
    const page = await accessPage(obj.board_url[i].url);

    const img_src = await getThumbImgSrc(page);
    const _order = obj.board_url[i].order;
    const name = obj.board_url[i].name;

    res.push({
      src: img_src,
      order: _order,
      name: name
    })
    console.timeLog("----time");
  }

  await deletePage();

  event.reply("thumb-data", res);
  console.timeEnd("----time");
  console.log("done\n");
})

// 썸네일 버튼 렌더링 완료
// 첫번째 웹페이지 크롤링 및 데이터 전송
// 응답 전송 channel - "page-info"
ipcMain.on("did-gen-board-btn", async (event, args)=>{
  console.time("----time");
  console.log("==== finish generate button. start first webpage crawling");

  // 저장된 첫번째 웹페이지 데이터 크롤링
  let result = await getWebPageInfo(0);
  result.present_page = 1;
  await deletePage();
  
  //게시판 글 목록 데이터 전송
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
  const page = await accessPage(page_url);
  let result = {};

  //크롤링
  result.page = await getPageNum(page, board_order);
  result.post = await getPostsData(page);

  // page=** => page, **
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

var new_count = 0;
ipcMain.on("add-board", (event, args)=>{
  console.log("add new board information");
  
  obj.board_url.push({
    name: args.name,
    order: String(obj.board_url.length + new_count),
    url: args.url
  })

  const data = JSON.stringify(obj.board_url, null, "\t");

  fs.writeFile('./board.json', data, err => {
    if (err) {
      console.error(err);
    }
  });

  new_count += 1;
  dialog.showMessageBoxSync(app.win, {
    message: "프로그램을 재시작해야 합니다.",
    button: ['ok']
  });
})

/* 크롤링 시작 후
1. main은 플랫폼마다 다른 데이터를 가공
2. render는 데이터 받아서 단순 렌더링

//  -- ipc data format
// 게시판 버튼 생성용
[
    {
      name:"~~~", // 내가 정한 게시판 이름
      order:"~~~", // 순서
      src:"~~" // 이미지 주소
    },
    ...
]

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
