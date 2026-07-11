import { createRequire } from 'module'
import fs from 'node:fs'
import { close_api, delay, send, startService } from "./utils/utils.js";
import { printGreen, printMagenta, printRed, printYellow } from "./utils/colorOut.js";
import { summarizeResponse } from "./utils/safeLog.js";
import { upsertUser, saveUserinfo } from "./utils/userinfo.js";

const require = createRequire(import.meta.url)
const QRCode = require('./api/node_modules/qrcode')

/**
 * 渲染 QR 矩阵为纯 ASCII 文本（无 ANSI 转义码）
 * 每个模块用双字符宽度，保证在等宽字体下比例正确
 * @param {string} url - 需要编码为二维码的 URL
 * @returns {string} ASCII 二维码文本
 */
function renderQrAscii(url) {
  const qr = QRCode.create(url, { margin: 1 })
  const size = qr.modules.size
  const get = qr.modules.get
  let ascii = ''
  for (let r = 0; r < size; r++) {
    let line = ''
    for (let c = 0; c < size; c++) {
      line += get(c, r) ? '██' : '  '
    }
    ascii += line + '\n'
  }
  return ascii
}

/**
 * 显示二维码
 * - GitHub Actions: 写入 Step Summary（ASCII 渲染） + 保存 PNG 供 artifact 下载
 * - 本地终端: 直接输出 ASCII + 链接
 * @param {string} url - 需要编码为二维码的 URL
 */
async function displayQrcode(url) {
  const ascii = renderQrAscii(url)

  // 保存 PNG 文件，供 workflow 上传为 artifact
  try {
    await QRCode.toFile('./qr-code.png', url, { width: 256, margin: 2 })
  } catch {
    // PNG 保存失败不影响主流程
  }

  const stepSummary = process.env.GITHUB_STEP_SUMMARY
  if (stepSummary) {
    const content = [
      '## 🎵 酷狗音乐扫码登录',
      '',
      '请使用 **酷狗音乐 APP** 扫描下方二维码登录',
      '',
      '```',
      ascii,
      '```',
      '',
      '> 如上方二维码无法扫描，可在下方 **Artifacts** 区域下载 `qr-code.png` 高清图片',
      '',
      '或复制此链接到浏览器打开扫码：',
      '',
      url,
      '',
    ].join('\n')
    fs.appendFileSync(stepSummary, content)
    printGreen('二维码已写入运行摘要页面（Summary）')
  } else {
    // 本地运行：直接输出到终端
    console.log(ascii)
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
