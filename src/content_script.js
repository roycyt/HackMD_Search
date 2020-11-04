﻿let GLOBAL_envs = {};

window.onload = async function () {
    console.log("1");
    GLOBAL_envs = await readEnv();
    BackupToStorage();
    setInterval(BackupToStorage, 30000);
}

document.addEventListener("keydown", async function (e) {
    if (/select-one/.test($(e.target).attr("type")) && e.key == "Enter" && /\?nav=/.test(location.href)) {
        if (e.target.value == "?BackupAllNotes") {
            await BackupAllNotes();
            return;
        }
        await searchFromStorage(e.target.value);
    }
})

function escape_html(str) {
    if (!str) return;
    return str.replace(/[<>&"'`]/g, (match) => {
        const escape = {
            '<': '&lt;',
            '>': '&gt;',
            '&': '&amp;',
            '"': '&quot;',
            "'": '&#39;',
            '`': '&#x60;'
        };
        return escape[match];
    });
}

async function readEnv(env_file = ".env") {
    data = await fetch(chrome.runtime.getURL(env_file)).then(res => res.text())
        .then(d => d.replace(/\r\n|\r|\n/g, "__SPLIT__").split("__SPLIT__").filter(d => d));
    return data.map(d => d.split("=")).reduce((dict, cur) => {
        dict[cur[0]] = cur[1];
        return dict;
    }, {});
}



async function BackupToStorage() {
    if (/\?nav=/.test(location.href)) return;
    const hackmd_url = "https://hackmd.io"
    //obtain from HackMD DOM
    const note_title = $("head > title").text().match(/^.*(?=\s-\sHackMD$)/)[0].replace(/\s|\//g, "_");
    const note_id = location.href.match(/(?<=hackmd.io\/)[^\?]+/)[0];
    //obtain note content with HackMD REST API
    const note_md = await fetch(`${hackmd_url}/${note_id}/download`).then(d => d.text());
    console.log(note_title);
    // 保存した日付もつけるかはそのうち考える
    chrome.storage.local.get({ "backup": {} }, async (backup_obj) => {
        console.log(backup_obj);
        backup_obj["backup"][note_id] = note_md;
        await chrome.storage.local.set({ "backup": backup_obj["backup"] });
    });
}

async function BackupAllNotes() {
    const hackmd_url = "https://hackmd.io";
    const hackmd_histories = await fetch(`${hackmd_url}/history`).then(d => d.json()).then(d => d["history"]);
    console.log(hackmd_histories[1])
    let idAndNotes = [];
    for (const history of hackmd_histories) {
        orig_id = history.id;
        console.log(orig_id);
        const id_tmp = orig_id.match(/^[^\?]+(?=\??.*$)/)[0];
        if (idAndNotes.map(d=>d.id).indexOf(id_tmp)!=-1 || /^@/.test(id_tmp)) continue;
        console.log(orig_id, id_tmp);
        idAndNotes.push({
            id: id_tmp,
            md: await fetch(`${hackmd_url}/${id_tmp}/download`).then(d => d.text())
        });
    };
    console.log(idAndNotes);
    chrome.storage.local.clear();
    chrome.storage.local.get({ "backup": {} }, async (backup_obj) => {
        for (const idAndNote of idAndNotes) {
            backup_obj["backup"][idAndNote.id] = idAndNote.md;
        }
        await chrome.storage.local.set({ "backup": backup_obj["backup"] });
    })
    console.log("Finished");
}

function searchQuerySplit(q){
    const replace_obj={"\\\\": "__BACKSLASH__", '\\"':"__WQ__"};
    const escaped_q=Object.keys(replace_obj).reduce((acc, key)=>acc.split(key).join(replace_obj[key]), q);
    console.log(escaped_q)
    const escaped_q2=escaped_q.replace(/\s+/g, " ").replace(/^"/g, ' "').split(' "').map((d,ind)=>{
        if (ind%2==0) return d;
        else d.replace(/ /g, "__SPACE__").replace(/"$/, "");
    }).join("");
    return Object.keys(replace_obj).reduce((acc,key)=>acc.split(replace_obj[key]).join(key), escaped_q2)
    .split(" ").map(d=>d.replace(/__SPACE__/g, " "));
}

async function searchFromStorage(q_in = "") {
    const queries_tmp=searchQuerySplit(q_in);
    const queries={ minus:queries_tmp.filter(d=>/^-/.test(d)).map(d=>d.slice(1)),
        reg:queries_tmp.filter(d=>/^reg:/.test(d)).map(d=>d.slice(4)),
        plus:queries_tmp.filter(d=>!/^-|^reg:/.test(d)).map(d=>d.replace(/^\\(?=(-|reg:))/, ""))};
    chrome.storage.local.get({ "backup": {} }, async (result) => {
        const result_ids = Object.keys(queries).reduce((acc, key)=>{
            return acc.filter(id => queries[key].every(q=>{
                if (key=="plus") return result["backup"][id].indexOf(q) != -1;
                if (key=="minus") return result["backup"][id].indexOf(q) == -1;
                if (key=="reg") return new RegExp(q).test(result["backup"][id]);
            }))}, Object.keys(result["backup"]));
        await showSearchResult(result_ids, queries["plus"]);
    });
}

async function showSearchResult(result_ids, queries) {
    const height = 130 + 117 * 2 * (Math.floor(result_ids.length / 2) + 1);
    const constant_part = {
        head: `<div aria-label="grid" aria-readonly="true" class="ReactVirtualized__Grid ReactVirtualized__List"
         role="grid" tabindex="0" style="box-sizing: border-box; direction: ltr; height: ${height}px; position: relative;
          width: 100%; will-change: transform; overflow: auto;">
            <div class="ReactVirtualized__Grid__innerScrollContainer" role="rowgroup" style="width: 100%; height: ${height}px;
             max-width: 100%; overflow: hidden; position: relative;">
            <div style="height: ${height}px; left: 0px; position: absolute; top: 0px; width: 100%;">
            <div class="list-section" style="padding-top: 5px; padding-bottom: 8px;">
            <h1><span>全文検索結果</span></h1>`,
        ul: `<ul class="list inline-flex flex-row flex-wrap justify-content-start list-style-none pl-0 w-100"
        id="list_ul_searchResult">`,
        foot: `</ul></div></div></div>`
    };

    const first_search = $("#list_ul_searchResult").length > 0 ? false : true;
    if (!first_search) $("#list_ul_searchResult").empty();

    let result_html = !first_search ? "" : constant_part.head + constant_part.ul;

    const hackmd_url = "https://hackmd.io";
    const hackmd_histories = await fetch(`${hackmd_url}/history`).then(d => d.json()).then(d => d["history"]);

    chrome.storage.local.get({ "backup": {} }, backup_obj => {
        for (const note_id of result_ids) {
            try {
                const note_title = escape_html(hackmd_histories.filter(d => d.id == note_id)[0]["text"]);
                const note_md = backup_obj["backup"][note_id];
                const note_url = `${hackmd_url}/${note_id.match(/^[^\?]+(?=\??.*$)/)[0]}`;
                const searched_parts = queries.reduce( (acc,q)=>
                acc.concat( note_md.match(new RegExp(`(.|\n){0,30}${q}(.|\n){0,30}`, "gi") )
                .map(d=>d.replace(new RegExp(q, "gi"),`<span style="color: orange;">${q}</span>`)) ), []).join("......");
                const result_part = `<li class="col-xs-12 col-sm-6 col-md-6 col-lg-4 list-style-none">
                        <div class="overview-card-container" style="height: 234px; overflow:hidden;">
                        <a class="card-anchor" href="${note_url}"></a>
                        <div class="item" style="height: 220px; overflow:hidden;">
                        <div class="content text-left pt-1 pr-3/2 pl-3" style="max-height: 220px; overflow:hidden;">
                        <a href="${note_url}">
                        <h4 class="ml-0 mt-0 mb-1/2 text flex items-end" title="${note_title}">
                    <span class="title">${note_title}</span></h4></a>
                        <a href="${note_url}">${searched_parts}</a></div>`
                result_html += result_part;
            } catch { console.log(note_id); };
        }
        result_html += !first_search ? "" : constant_part.foot;
        if(first_search){
            const ov = $(".overview-component");
            const marker = $("div:eq(0)", ov);
            marker.after(result_html);
        } else {
            const marker = $("#list_ul_searchResult");
            marker.append(result_html);
        }

    });


}



