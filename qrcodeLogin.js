import { createRequire } from 'module'
import fs from 'node:fs'
import { close_api, delay, send, startService } from "./utils/utils.js";
import { printGreen, printMagenta, printRed, printYellow } from "./utils/colorOut.js";
import { summarizeResponse } from "./utils/safeLog.js";
import { upsertUser, saveUserinfo } from "./utils/userinfo.js";

const require = createRequire(import.meta.url)
const QRCode = require('./api/node_modules/qrcode')

/**
 * 显示二维码
 * 在 GitHub Actions 中写入 Step Summary 以渲染真实图片；
 * 在本地终端输出可扫码链接作为降级。
 * @param {string} url - 需要编码为二维码的 URL
 */
async function displayQrcode(url) {
  // 生成 base64 PNG 图片
  const dataUrl = await QRCode.toDataURL(url, { width: 256, margin: 2 })

  // 写入 GitHub Actions Step Summary（运行摘要页面直接显示图片）
  const stepSummary = process.env.GITHUB_STEP_SUMMARY
  if (stepSummary) {
    const content = [
      '## 酷狗音乐扫码登录',
      '',
      `<img src="${dataUrl}" width="256" />`,
      '',
      '请使用 **酷狗音乐 APP** 扫描上方二维码登录',
      '',
      `如图片未显示，请复制此链接到浏览器打开扫码：`,
      '',
      url,
      '',
    ].join('\n')
    fs.writeFileSync(stepSummary, content)
    printGreen('二维码已显示在运行摘要页面（Summary）中')
  } else {
    // 本地运行降级：输出链接
    printMagenta('请复制此链接到浏览器打开，使用酷狗音乐 APP 扫码登录：')
    console.log(url)
  }
}

async function qrcode() {

  // 启动服务
  const api = startService()
  await delay(2000)
  let qrcode = ""
  const USERINFO = process.env.USERINFO
  const APPEND_USER = process.env.APPEND_USER
  const userinfo = (USERINFO && APPEND_USER == "是") ? JSON.parse(USERINFO) : []
  const args = process.argv.slice(2);
  const number = parseInt(process.env.NUMBER || args[0] || "1")
  try {
    for (let n = 0; n < number; n++) {
      // 二维码
      const result = await send(`/login/qr/key?timestrap=${Date.now()}`, "GET", {})
      if (result.status === 1) {
        qrcode = result.data.qrcode
        const qrUrl = `https://h5.kugou.com/apps/loginQRCode/html/index.html?qrcode=${qrcode}`
        await displayQrcode(qrUrl)
      } else {
        printRed("响应内容")
        console.dir(summarizeResponse(result), { depth: null })
        throw new Error("请求出错")
      }
      printMagenta("正在等待，请扫描二维码并确定登录")
      // 登录
      for (let i = 0; i < 25; i++) {
        const timestrap = Date.now();
        const res = await send(`/login/qr/check?key=${qrcode}&timestrap=${timestrap}`, "GET", {})
        const status = res?.data?.status
        switch (status) {
          case 0:
            printYellow("二维码已过期")
            break

          case 1:
            // 未扫描二维码
            break

          case 2:
            // 二维码未确认，请点击确认登录
            break

          case 4:
            printGreen("登录成功！")
            upsertUser(userinfo, { userid: res.data.userid, token: res.data.token }, APPEND_USER == "是")
            break

          default:
            printRed("请求出错")
            console.dir(summarizeResponse(res), { depth: null })
        }
        if (status == 4 || status == 0) {
          break
        }
        if (i == 24) {
          printRed("等待超时\n")
          break
        }
        await delay(5000)
      }
    }
    saveUserinfo(userinfo)
  } finally {
    close_api(api)
  }

  if (api.killed) {
    process.exit(0)
  }
}

qrcode()
