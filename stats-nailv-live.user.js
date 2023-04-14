// ==UserScript==
// @name         stats.nailv.live
// @namespace    http://tampermonkey.net/
// @license      MIT
// @version      0.1
// @description  In case I don't see ya, good afternoon, good evening and good night.
// @author       NailvCoronation
// @match        https://live.bilibili.com/*
// @icon         https://nailv.live/static/images/favicon.ico
// @require      https://cdn.jsdelivr.net/npm/chart.js@4.2.1/dist/chart.umd.min.js
// @require      https://cdn.jsdelivr.net/npm/chartjs-plugin-annotation@2.2.1/dist/chartjs-plugin-annotation.min.js
// @require      https://code.jquery.com/jquery-3.6.0.min.js
// @grant        GM_addStyle
// @run-at       document-idle
// @noframes
// ==/UserScript==

const channelApi = 'https://api.ukamnads.icu/api/v2/channel?uid='
const streamApi = 'https://api.ukamnads.icu/api/v2/live?includeExtra=true&liveId='

const nMinute = 10  // TODO: custom interval
const roomId = document.URL.split('/').pop().split('?')[0]
var uid = 0
var charts = []
const chartTitles = ['弹幕', '活跃用户', '营收', '高能', '互动/高能比例', '新观众']

var streamId = 0
var lastTenStreams = []
var oldViewers = new Set()

function sleep(sec) {
    return new Promise(resolve => setTimeout(resolve, sec * 1000));
}

async function getLiveStatus(roomId) {
    try {
        let resp = await fetch(`https://api.live.bilibili.com/xlive/web-room/v1/index/getInfoByRoom?room_id=${roomId}`)
        resp = await resp.json()
        if (resp.data.room_info.live_status === 0) {
            return false
        }
        uid = resp.data.room_info.uid
        return true
    } catch (e) {
        return false
    }
}

function getNMinuteIntervals(startTimestamp, endTimestamp) {
    const nMinutes = nMinute * 60 * 1000;
    const intervals = [];
    const start = new Date(startTimestamp);
    const end = new Date(endTimestamp);
    
    for (let time = start; time < end; time.setTime(time.getTime() + nMinutes)) {
        intervals.push(time.getTime());
    }
    
    return intervals;
}

function findClosestTimestampBefore(timestamp, timestamps) {
    const idx = timestamps.findIndex((t) => t >= timestamp);
    if (idx === 0) {
        return timestamps[0];
    }
    if (idx === -1) {
        return timestamps[timestamps.length - 1]
    }
    return timestamps[idx - 1];
}

function getDataset(stream) {
    const actions = stream.danmakus
    const nMinuteIntervals = getNMinuteIntervals(actions[0].sendDate, actions[actions.length - 1].sendDate)

    let danmakuNum = {}
    let activeViewers = {}
    let income = {}
    let newViewers = {}
    let onlineNum = {}
    let viewers = new Set()
    nMinuteIntervals.forEach(interval => {
        danmakuNum[interval] = 0
        activeViewers[interval] = new Set()
        income[interval] = 0
        newViewers[interval] = 0
        onlineNum[interval] = []
    })

    actions.filter(action => [0, 1, 2, 3].includes(action.type))
        .forEach(action => {
            let interval = findClosestTimestampBefore(action.sendDate, nMinuteIntervals)
            if (action.type === 0)
                danmakuNum[interval] += 1
            else
                income[interval] += action.price
            activeViewers[interval].add(action.uId)
            if (!viewers.has(action.uId) && !oldViewers.has(action.uId)) 
                newViewers[interval] += 1
            viewers.add(action.uId)
        })
    Object.entries(stream.live.extra.onlineRank).forEach(kv => {
        const time = kv[0]
        const online = kv[1]
        const interval = findClosestTimestampBefore(time, nMinuteIntervals)
        onlineNum[interval].push(online)
    })
    return [
        {   // danmakus
            labels: nMinuteIntervals.map(ts => (new Date(ts)).toLocaleTimeString('zh-CN', { timeStyle: 'short' })),
            datasets: [{
                data: Object.values(danmakuNum),
            }]
        },
        {   // activeViewer
            labels: nMinuteIntervals.map(ts => (new Date(ts)).toLocaleTimeString('zh-CN', { timeStyle: 'short' })),
            datasets: [{
                data: Object.values(activeViewers).map(s => s.size),
            }]
        },
        {   // income
            labels: nMinuteIntervals.map(ts => (new Date(ts)).toLocaleTimeString('zh-CN', { timeStyle: 'short' })),
            datasets: [{
                data: Object.values(income),
            }]
        },
        {   // online
            labels: nMinuteIntervals.map(ts => (new Date(ts)).toLocaleTimeString('zh-CN', { timeStyle: 'short' })),
            datasets: [{
                data: Object.values(onlineNum)  // array of arrays
                    .map(arr => (arr.reduce((sum, x) => sum + x, 0) / arr.length).toFixed(1)),
            }]
        },
        {   // viewer/online ratio
            labels: nMinuteIntervals.map(ts => (new Date(ts)).toLocaleTimeString('zh-CN', { timeStyle: 'short' })),
            datasets: [{
                data: Object.keys(onlineNum).map((ts, idx) => {
                    let online = onlineNum[ts].reduce((sum, x) => sum + x, 0) / onlineNum[ts].length
                    let viewer = activeViewers[ts].size
                    return (viewer / online).toFixed(3)
                }).map((ratio, idx) => idx === 0? NaN: ratio),
            }]
        },
        {   // newViewer
            labels: nMinuteIntervals.map(ts => (new Date(ts)).toLocaleTimeString('zh-CN', { timeStyle: 'short' })),
            datasets: [{
                data: Object.values(newViewers),
            }]
        },
    ]
}

async function updateChart() {
    if (!await getLiveStatus(roomId))
        return
    
    let resp
    try {
        resp = await fetch(streamApi + streamId)
        resp = await resp.json()
        if (resp.code !== 200)
            throw new Error(resp.message)
    } catch (e) {
        console.log(e)
    }

    let data = resp.data.data
    data.danmakus.sort((a, b) => a.sendDate - b.sendDate)
    if (data.danmakus.length === 0) {
        await sleep(10)
        await updateChart()
        return
    }
    const datasets = getDataset(data)
    charts.forEach((chart, idx) => {
        chart.data = datasets[idx]
        chart.update('none')
    })
    
    await sleep(30)
    await updateChart()
}

async function initChart() {
    while (true) {
        try {
            let resp = await fetch(channelApi + uid)
            resp = await resp.json()
            if (resp.code !== 200)
                throw new Error(resp.message)
            const streams = resp.data.lives.map(s => s.liveId)
            if (!streams[0].isFinish) {
                // found the correct stream
                streamId = streams[0]
                const lastTenSids = streams.slice(1, 11)
                lastTenStreams = []
                await initLastTenStreams(lastTenSids)
                addAnnotations()
                return
            }
        } catch (e) {
            console.log(e)
        }
        await sleep(10)
    }
}

function addAnnotations() {
    // add annotation for danmakus, activeViewer and onlineNum
    // namely, idx = 0, 1 and 3
    const baseOptions = {
        type: 'line',
        drawTime: 'beforeDatasetsDraw',
        borderColor: '#CE3B29',
        borderWidth: 2,
        label: {
            display: true,
            content: `过去${lastTenStreams.length}场直播均值`,
            backgroundColor: 'transparent',
            color: 'black',
            textStrokeColor: 'white',
            textStrokeWidth: 3,
        }
    }

    const avgDanmakuNum = lastTenStreams.reduce((sum, s) => sum + s.danmakuCount, 0)
    const minutes = lastTenStreams.reduce((sum, s) => sum + (s.endTime - s.startTime) / 1000 / 60, 0)
    const danmakuOptions = {
        ...baseOptions,
        display: isNaN(avgDanmakuNum / minutes * nMinute) ? false : true,
        yMin: avgDanmakuNum / minutes * nMinute,
        yMax: avgDanmakuNum / minutes * nMinute,
    }
    charts[0].options.plugins.annotation = { annotations: { options: danmakuOptions } }
    charts[0].update()

    let viewerPerNMinutes = []
    lastTenStreams.forEach(stream => {
        for (let idx = 0; idx < stream.viewerPerMinute.length; idx+=nMinute) {
            let data = stream.viewerPerMinute.slice(idx, idx + nMinute).map(d => d.uids)
            let temp = new Set()
            data.forEach(d => d.forEach(x => temp.add(x)))
            viewerPerNMinutes.push(temp)
        }
    })
    const viewerNum = viewerPerNMinutes.reduce((sum, x) => sum + x.size, 0) / viewerPerNMinutes.length
    const viewerNumOptions = {
        ...baseOptions,
        display: isNaN(viewerNum) ? false : true,
        yMin: viewerNum,
        yMax: viewerNum,
    }
    charts[1].options.plugins.annotation = { annotations: { options: viewerNumOptions } }
    charts[1].update()

    const onlineNum = lastTenStreams
        .filter(s => !isNaN(s.onlineNum))
        .reduce((sum, s) => sum + s.onlineNum, 0) / lastTenStreams.filter(s => !isNaN(s.onlineNum)).length
    const onlineNumOptions = {
        ...baseOptions,
        display: isNaN(onlineNum) ? false : true,
        yMin: onlineNum,
        yMax: onlineNum,
    }
    charts[3].options.plugins.annotation = { annotations: { options: onlineNumOptions } }
    charts[3].update()
}

async function initLastTenStreams(sids) {
    if (sids.length === 0)
        return
    let promises = []
    sids.forEach(sid => {
        let promise = fetch(streamApi + sid)
            .then(resp => resp.json())
            .then(stream => {
                if (stream.code !== 200)
                    throw new Error(stream.message)
                let danmakus = stream.data.data.danmakus
                    .filter(action => [0, 1, 2, 3].includes(action.type))
                    .sort((a, b) => a.sendDate - b.sendDate)
                danmakus.forEach(d => oldViewers.add(d.uId))
                let viewerPerMinute = danmakus.length > 0? [{ time: danmakus[0].sendDate, uids: new Set() }]: []
                danmakus.forEach(danmaku => {
                    while (danmaku.sendDate - viewerPerMinute[viewerPerMinute.length - 1].time > 1000 * 60) {
                        viewerPerMinute.push({ time: viewerPerMinute[viewerPerMinute.length - 1].time + 1000 * 60, uids: new Set() })
                    }
                    viewerPerMinute[viewerPerMinute.length - 1].uids.add(danmaku.uId)
                })

                stream = stream.data.data.live
                lastTenStreams.push({
                    id: stream.liveId,
                    startTime: stream.startDate,
                    endTime: stream.stopDate,
                    danmakuCount: stream.danmakusCount,
                    income: stream.totalIncome,
                    viewerCount: stream.interactionCount,
                    onlineNum: (Object.values(stream.extra.onlineRank).slice(Object.values(stream.extra.onlineRank).length * 0.1).reduce((sum, x) => sum + x, 0) / (Object.values(stream.extra.onlineRank).length * 0.9)),
                    viewerPerMinute: viewerPerMinute,
                })
                sids.splice(sids.indexOf(sid), 1)
            })
            .catch(e => {
                console.log(e)
            })
        promises.push(promise)
    })
    await Promise.all(promises)
    await sleep(5)
    initLastTenStreams(sids)
}


(async () => {
    'use strict';

    let $icon = $('<img>', {
        id: 'floating-window-icon',
        src: 'https://nailv.live/static/images/favicon.ico',
        alt: 'Expand window'
    }).appendTo('body');

    $icon.on('click', function() {
        $window.toggle();
    });

    let $window = $('<div>', {
        id: 'floating-window'
    }).appendTo('body');

    let title = $('<h4>', {
        id: 'floating-window-title'
    }).appendTo('#floating-window')
    title.html('本场直播数据')

    // Chart canvas
    const canvasDiv = $('<div>', {
        id: 'canvas-div'
    }).appendTo('#floating-window')
    let ctxes = []
    ctxes.push($('<canvas>', {
        class: 'chart-canvas'
    }).appendTo('#canvas-div')[0].getContext('2d'))
    ctxes.push($('<canvas>', {
        class: 'chart-canvas'
    }).appendTo('#canvas-div')[0].getContext('2d'))
    ctxes.push($('<canvas>', {
        class: 'chart-canvas'
    }).appendTo('#canvas-div')[0].getContext('2d'))
    ctxes.push($('<canvas>', {
        class: 'chart-canvas'
    }).appendTo('#canvas-div')[0].getContext('2d'))
    ctxes.push($('<canvas>', {
        class: 'chart-canvas'
    }).appendTo('#canvas-div')[0].getContext('2d'))
    ctxes.push($('<canvas>', {
        class: 'chart-canvas'
    }).appendTo('#canvas-div')[0].getContext('2d'))
    
    ctxes.forEach((ctx, idx) => {
        charts.push(new Chart(ctx, {
            type: 'line',
            options: {
                borderColor: '#648140',
                color: '#90EE90',
                interaction: {
                    intersect: false,
                    mode: 'index'
                },
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        backgroundColor: '#E2E6AF',
                        bodyColor: '#000000',
                        titleColor: '#000000',
                        displayColors: false,
                        footerFont: { size: 10 },
                        callbacks: {
                            label: (context) => chartTitles[idx] + '：' + context.parsed.y,
                            title: (context) => context[0].label + '~' + new Date((new Date('2022/09/17 ' + context[0].label)).getTime() + (nMinute - 1) * 60 * 1000).toLocaleTimeString('zh-CN', { timeStyle: 'short' })
                        }
                    },
                    title: {
                        display: true,
                        text: chartTitles[idx]
                    },
                },
                scales: {
                    y: {
                        beginAtZero: true
                    }
                }
            }
        }))
    })

    $('<p>', { id: 'ad' }).appendTo('#floating-window')
        .html('更多数据，请访问<a href="https://stats.nailv.live" style="text-decoration: none;" target="_blank">stats.nailv.live</a>')

    while (true) {
        if (await getLiveStatus(roomId)) {
            title.html('本场直播数据')
            canvasDiv.show()
            await initChart()
            await updateChart() //recursion function, return when current stream ends
        } else {
            title.html('未在直播')
            canvasDiv.hide()
            await sleep(15)
        }
    }
})();


GM_addStyle(`
    #floating-window-icon {
        position: fixed;
        top: 10%;
        right: 3%;
        transform: translate(50%, -50%);
        width: 40px;
        height: 40px;
        background-color: #ccc;
        border-radius: 50%;
        cursor: pointer;
        z-index: 10000;
    }
    #floating-window {
        position: fixed;
        top: 10%;
        right: 3%;
        width: 20%;
        max-height: 60%;
        background-color: #fff;
        border: 1px solid #ccc;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
        z-index: 9999;
        display: none;
        overflow-y: auto;
    }
    #floating-window-title {
        text-align: center;
    }
    #ad {
        text-align: center;
        bottom: 0;
    }
    .chart-canvas {
        width: 100%;
    }
`);