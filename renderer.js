const {ipcRenderer} = require('electron');

/**
 * 
 * @param {Object} data 
 * @param {String} data.name
 * @param {String} data.order
 * @param {String} data.src
 */
function createBoardButton(data){
    const div_board_list = document.querySelector('#div_board_list');

    const img_url = data.src;
    const order = data.order;
    const name = data.name;

    // 게시판 변경용 버튼 만들기
    const html = `
    <button type="button" class="button_board" id="btn_${order}" title="${name}">
        <img src=${img_url} alt="⚠️이미지⚠️" class="thumbimg" width="58" height="55">
    </button>`;
    div_board_list.insertAdjacentHTML('beforeend', html); //html에 등록

    // 버튼 클릭  이벤트 등록
    const btn = document.getElementById(`btn_${order}`);
    btn.addEventListener("click",() => {
        const btn_id_num = btn.id.split("_")[1];
        if(state.present_board == btn_id_num) return; //현재 게시판 버튼 누를 때, 동작하지 않음

        state.present_board = btn_id_num;
        ipcRenderer.send("load-new-board", btn_id_num);

        //버튼 클릭 시 활성 표시 바꿔주기
        const elements = document.querySelectorAll(".button_board > img");
        elements.forEach(element => {
            element.classList.remove('thumbimg_on');
        });
        
        const board_img = btn.querySelector('img');
        board_img.classList.add('thumbimg_on');
    })
}

/**
 * 
 * @param {*} array
 * @param {*} page_n
 */
function displayPageNum(array, page_n){
    console.log("페이지 번호: ", page_n);
    console.log("번호 개수: ", array.length);
    // 매번 기존 버튼 없애고 새로 만들기 - 새로운 페이지 크롤링,랜더링 할때 동일
    // html 요소 생성하기 전에 기존 요소없애기
    // replaceChildren 파라미터가 없으면 모든 자식 노드가 삭제됨
    document.querySelector('#div_page_num').replaceChildren();
    const div_page_num = document.querySelector('#div_page_num');
    
    let html = "";
    for(let i=0; i<array.length; i++){
        let html_part;
        if(array[i].num == "이전"){
            html_part = `<button type="button" class="button_page" id="previous">${array[i].num}</button>`;
        }
        else if(array[i].num == "다음"){
            html_part = `<button type="button" class="button_page" id="next">${array[i].num}</button>`;
        }
        else{ // 숫자
            html_part = `<button type="button" class="button_page">${array[i].num}</button>`;
        }
        html = html + html_part;
    }
    // html 등록
    div_page_num.insertAdjacentHTML('afterbegin', html);

    // 생성된 페이지 버튼 이벤트 등록
    const button_array = document.querySelectorAll(".button_page");
    for(let i=0; i<button_array.length; i++){
        button_array[i].addEventListener('click', ()=>{
            // 크롤링 다시하고 새로 랜더링하기 위함.
            console.log("새 페이지 로드 이벤트 발생");
            console.log("i",i," url", array[i].url);
            ipcRenderer.send('load-new-page', [button_array[i].innerText, array[i].url, state.present_board]);
        });

        // 현재 페이지 표기용 버튼 색깔 변경
        if(button_array[i].innerText == page_n){
            button_array[i].classList.add("button_page_on");
        }
    }
}

/**
 * 게시판 글제목, 작성자, 작성일 출력
 * @param {Object[]} array
 * @param {String} array[].title
 * @param {String} array[].url
 * @param {String} array[].author
 * @param {String} array[].date
 */
function displayPost(array){
    // html 요소 생성하기 전에 기존 요소없애기
    // replaceChildren 파라미터가 없으면 모든 자식 노드가 삭제됨
    document.querySelector('#table_post > tbody').replaceChildren();
    const tbody = document.querySelector('#table_post > tbody');

    let html = "";//""로 선언 안하면 undefined 나옴
    for(let i=0; i<array.length; i++){
        // 글 제목
        html_title = `
        <td>
            <a href="#" onclick='openPage("${array[i].url}")'>${array[i].title}</a>
        </td>`;
        //onclick 파라미터에 따옴표 해줘야함
        
        // 글 작성자
        html_author = `
        <td>
            <p>${array[i].author}</p>
        </td>`;

        // 글 작성일
        html_date = `
        <td>
            <p>${array[i].date}</p>
        </td>`;

        //합치기
        html = html + `
        <tr id="tr_content">
            ${html_title}
            ${html_author}
            ${html_date}
        </tr>`;
    }
    tbody.insertAdjacentHTML('afterbegin', html);
}

/**
 * displayPost의 글제목(a 태그)의 클릭 이벤트 함수
 * @param {String} url 
 */
function openPage(url){
    console.log("글 클릭 이벤트 발생");
    console.log(url);
    //일렉트론으로 새창이 생성됨.
    //window.open(url, "newWindow");
    //설치된 로컬 브라우저에서 실행하기 위해 nodejs로 넘김
    ipcRenderer.send("new-window", url);
}

/**
 * 게시판의 제목, 브랜드 이름 출력
 * @param {Object} info
 * @param {String} info.brand
 * @param {String} info.board
 */
function displayInfo(info){
    const p_board = document.querySelector("#div_board_title > p");
    const p_brand = document.querySelector("#div_brand_name > p");

    p_board.innerText = info.board;
    p_brand.innerText = info.brand;
}

let state = {present_board:-1, board_info:0};

/** 순서
 * 1. electron 첫 실행시 json파일에 저장된 데이터를 가지고 옴
 * 2. 데이터를 설정 페이지에 출력
 * 3. main process로 첫번째 url의 글들 크롤링 시작 이벤트 발생
 */
window.addEventListener("load", function(){
    ipcRenderer.on("json-data",
        /**
         * 
         * @param {Electron.IpcRendererEvent} event 
         * @param {Object[]} args
         * @param {String} args[].name
         * @param {String} args[].order
         * @param {String} args[].url
         */
        async (event, args)=>{
            // 설정 페이지에 출력
            state.board_info = args;

            const div_list_frame = document.querySelector("#div_list_frame");
            for(let i=0; i<state.board_info.length; i++){
                let html_part = `
                <div>
                    <p>이름 <span>${state.board_info[i].name}</span></p>
                    <p>utl <span>${state.board_info[i].url}</span></p>
                </div>`;

                div_list_frame.insertAdjacentHTML('beforeend', html_part);
            }
    })

    // puppeteer 작업 시작을 위한 이벤트 발생
    ipcRenderer.send("did-finish-init", "아무말");
})


// 우선 저장된 웹페이지들 대표 이미지로 버튼만들기
// 이후 첫번째 게시판 정보 요청
ipcRenderer.on('thumb-data',
    /**
     * 
     * @param {Electron.IpcRendererEvent} event
     * @param {Object[]} args
     * @param {String} args.src
     * @param {String} args.order
     * @param {String} args.name
     */
    (event, args) => {
        console.log("thumb data");
        console.log(args);
        args = args.sort((a,b) => a.order - b.order);//오름차순 정렬 - 혹시 몰라서 했음

        state.present_board = 0;

        // 현재 크롤링하고 있는 게시판 색깔 표시

        for(let i=0; i<args.length; i++){
            createBoardButton(args[i]);

            // 게시판 첫번째 페이지 랜더링
            if(i==0){
                document.querySelector('#btn_0 > img').classList.add('thumbimg_on');
            }
        }
        ipcRenderer.send("did-gen-board-btn", "아무말");
})

//게시판 정보 출력
ipcRenderer.on("page-info",
    /**
     * 
     * @param {Electron.IpcRendererEvent} event
     * @param {Object} args
     * @param {Object} args.info
     * @param {Object[]} args.page
     * @param {Object[]} args.post
     * @param {String} args.present_page
     */
    (event, args) => {
        console.log("게시판 크롤링 완료");
        console.log(args);

        displayPost(args.post);
        displayPageNum(args.page, 1);//게시판이 바뀌거나 프로그램 첫 실행시 항상 1번 페이지
        displayInfo(args.info);
})

//페이지 버튼 이벤트로 새로운 페이지 크롤링 결과 랜더링
ipcRenderer.on("result-new-page", 
    /**
     * @param {Electron.IpcRendererEvent} event
     * @param {Object} args
     * @param {Object} args.info
     * @param {Object[]} args.page
     * @param {Object[]} args.post
     * @param {String} args.present_page
     */
    (event, args) =>{
        console.log("새로운 페이지 크롤링 완료");
        console.log(args);
        console.log(args.page);

        displayPageNum(args.page, args.present_page);
        displayPost(args.post);
})

let set_on = false;
const button_set = document.getElementById("button_set");
const div_set_frame = document.getElementById("div_set_frame");
const div_main = document.getElementById("div_main");
const div_etc = document.getElementById("div_etc");

button_set.addEventListener("click", ()=>{
    if(set_on==false){//설정화면 보이기
        div_set_frame.style.display = "inline-block";
        div_main.style.display = "none";
        div_etc.style.display = "none";
        set_on = true;
    }
    else{//true
        div_set_frame.style.display = "none";
        div_main.style.display = "inline";
        div_etc.style.display = "flex";
        set_on = false;
    }
})

document.getElementById("button_add").addEventListener("click", ()=>{
    const name = document.getElementById("input_name").value;
    const url = document.getElementById("input_url").value;
    
    if(name == "" || url == ""){
        alert("빈칸이 존재합니다.")
    }
    else{
        ipcRenderer.send("add-board",{name:name, url:url})
    }
})