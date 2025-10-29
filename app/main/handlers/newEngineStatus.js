const {ipcMain} = require("electron")
const childProcess = require("child_process")
const {GLOBAL_YAK_SETTING} = require("../state")
const {getLocalYaklangEngine, YakitProjectPath} = require("../filePath")
const {engineLogOutputFileAndUI, engineLogOutputUI} = require("../logFile")

const ECHO_TEST_MSG = "Hello Yakit!"

module.exports = {
    registerNewIPC: (win, callback, getClient, newClient, ipcEventPre) => {
        /** 输出到欢迎界面的日志中 */
        ipcMain.handle(ipcEventPre + "output-log-to-welcome-console", (e, msg) => {
            engineLogOutputUI(win, `${msg}`, true)
        })

        let currentCheckId = 0 // 全局任务标识
        const asyncAllowSecretLocal = async (win, params, attempt = 1, maxRetry = 3) => {
            const checkId = ++currentCheckId // 本次任务唯一 ID

            return new Promise((resolve, reject) => {
                try {
                    const command = getLocalYaklangEngine()
                    const port = params?.port || 9011
                    const args = ["check-secret-local-grpc", "--port", String(port)]

                    engineLogOutputFileAndUI(win, `----- 检查本地随机密码模式支持 -----`)
                    engineLogOutputFileAndUI(win, `执行命令: ${command} ${args.join(" ")}`)

                    const subprocess = childProcess.spawn(command, args, {
                        stdio: ["ignore", "pipe", "pipe"],
                        env: {...process.env, YAKIT_HOME: YakitProjectPath}
                    })

                    let stdout = ""
                    let stderr = ""
                    const timeoutMs = 10000
                    let killed = false

                    const timeoutId = setTimeout(() => {
                        killed = true
                        subprocess.kill()
                        try {
                            if (process.platform === "win32") {
                                childProcess.exec(`taskkill /PID ${subprocess.pid} /T /F`)
                            } else {
                                process.kill(subprocess.pid, "SIGKILL")
                            }
                        } catch {}
                        engineLogOutputFileAndUI(win, `----- 检查随机密码模式超时 -----`)
                        reject({status: "timeout", message: "检查随机密码模式超时"})
                    }, timeoutMs)

                    subprocess.stdout.on("data", (data) => {
                        if (checkId !== currentCheckId) return // 已过期任务不打印
                        const output = data.toString("utf-8")
                        stdout += output
                        engineLogOutputFileAndUI(win, output)
                    })

                    subprocess.stderr.on("data", (data) => {
                        if (checkId !== currentCheckId) return
                        const output = data.toString("utf-8")
                        stderr += output
                        engineLogOutputFileAndUI(win, output)
                    })

                    subprocess.on("error", (error) => {
                        if (checkId !== currentCheckId) return
                        clearTimeout(timeoutId)
                        engineLogOutputFileAndUI(win, `----- 检查随机密码模式失败 -----`)
                        engineLogOutputFileAndUI(win, `错误: ${error.message}`)
                        reject({status: "process_error", message: error.message})
                    })

                    subprocess.on("close", (code) => {
                        if (checkId !== currentCheckId || killed) return

                        clearTimeout(timeoutId)
                        const combinedOutput = (stdout + stderr).trim()
                        engineLogOutputFileAndUI(win, `----- 检查随机密码模式结束，退出码: ${code} -----`)

                        // 提取 JSON
                        const match = combinedOutput.match(/<json-[\w-]+>([\s\S]*?)<\/json-[\w-]+>/)
                        let json = null
                        if (match) {
                            try {
                                json = JSON.parse(match[1].trim())
                            } catch (e) {
                                engineLogOutputFileAndUI(win, `JSON 解析失败: ${e.message}`)
                            }
                        }

                        // 检查端口被占用错误
                        const portInUse =
                            /port.*(occupied|in use)/i.test(combinedOutput) ||
                            /bind.*Only one usage of each socket address/i.test(combinedOutput) ||
                            /address already in use/i.test(combinedOutput)

                        if (portInUse) {
                            const msg = `端口 ${
                                params?.port || 9011
                            } 已被占用，请检查是否已有其他 Yakit 实例或进程正在运行，建议用户手动释放或修改端口。`
                            engineLogOutputFileAndUI(win, `----- 检查失败: ${msg} -----`)
                            return reject({status: "port_occupied", message: msg, output: combinedOutput})
                        }

                        if (json && json.ok === true) {
                            engineLogOutputFileAndUI(win, `----- 随机密码模式检查通过 -----`)
                            return resolve({status: "success", json})
                        }

                        if (json && json.ok === false) {
                            engineLogOutputFileAndUI(win, `----- 检查失败: ${json.reason || "未知原因"} -----`)
                            return reject({status: "grpc_error", message: json.reason || "随机密码模式检查失败", json})
                        }

                        if (!json && /(\[FTAL\]|no such file or directory)/i.test(combinedOutput)) {
                            engineLogOutputFileAndUI(win, `----- 检查失败：旧版本引擎不支持随机密码模式 -----`)
                            return reject({status: "old_version", message: "旧版本引擎不支持随机密码模式"})
                        }

                        if (!json && !stdout && !stderr) {
                            engineLogOutputFileAndUI(win, `----- 检查失败：可能被杀软或防火墙拦截 -----`)
                            return reject({status: "antivirus_blocked", message: "可能被杀软或防火墙拦截"})
                        }
                        engineLogOutputFileAndUI(win, `----- 检查随机密码模式失败，输出不符合预期 -----`)
                        reject({status: "unknown", message: "输出不符合预期", output: combinedOutput})
                    })
                } catch (e) {
                    if (checkId !== currentCheckId) return
                    engineLogOutputFileAndUI(win, `----- 执行检查命令时发生异常 -----`)
                    engineLogOutputFileAndUI(win, `${e}`)
                    reject({status: "exception", message: e.message || String(e)})
                }
            }).catch(async (err) => {
                // 超时重试逻辑
                // if (err.status === "timeout" && attempt < maxRetry) {
                //     const nextAttempt = attempt + 1
                //     engineLogOutputFileAndUI(
                //         win,
                //         `----- 第 ${attempt} 次超时，1 秒后重试（剩余 ${maxRetry - attempt} 次） -----`
                //     )
                //     await new Promise((r) => setTimeout(r, 1000))
                //     return asyncAllowSecretLocal(win, params, nextAttempt, maxRetry)
                // }

                return Promise.reject({ok: false, ...err})
            })
        }
        ipcMain.handle(ipcEventPre + "check-allow-secret-local-yaklang-engine", async (e, params) => {
            try {
                const result = await asyncAllowSecretLocal(win, params)
                return {ok: true, ...result}
            } catch (err) {
                const safeError = typeof err === "object" && err !== null ? err : {message: String(err)}
                return {
                    ok: false,
                    status: safeError.status || "unknown",
                    message: safeError.message || "未知错误",
                    json: safeError.json || null
                }
            }
        })

        /** 连接引擎 */
        ipcMain.handle(ipcEventPre + "connect-yaklang-engine", async (e, params) => {
            /**
             * connect yaklang engine 实际上是为了设置参数，实际上他是不知道远程还是本地
             * params 中的参数应该有如下：
             *  @Host: 主机名，可能携带端口
             *  @Port: 端口
             *  @Sudo: 是否是管理员权限
             *  @IsTLS?: 是否是 TLS 加密的
             *  @PemBytes?: Uint8Array 是 CaPem
             *  @Password?: 登陆密码
             */
            const hostRaw = `${params["Host"] || "127.0.0.1"}`
            let portFromRaw = `${params["Port"]}`
            let hostFormatted = hostRaw
            if (hostRaw.lastIndexOf(":") >= 0) {
                portFromRaw = `${parseInt(hostRaw.substr(hostRaw.lastIndexOf(":") + 1))}`
                hostFormatted = `${hostRaw.substr(0, hostRaw.lastIndexOf(":"))}`
            }
            const addr = `${hostFormatted}:${portFromRaw}`
            engineLogOutputFileAndUI(win, `原始参数为: ${JSON.stringify(params)}`)
            engineLogOutputFileAndUI(win, `开始连接引擎地址为：${addr} Host: ${hostRaw} Port: ${portFromRaw}`)
            GLOBAL_YAK_SETTING.defaultYakGRPCAddr = addr

            callback(
                GLOBAL_YAK_SETTING.defaultYakGRPCAddr,
                Buffer.from(params["PemBytes"] === undefined ? "" : params["PemBytes"]).toString("utf-8"),
                params["Password"] || ""
            )
            return await new Promise((resolve, reject) => {
                newClient().Echo({text: ECHO_TEST_MSG}, (err, data) => {
                    if (err) {
                        reject(err + "")
                        return
                    }
                    if (data["result"] === ECHO_TEST_MSG) {
                        resolve(data)
                    } else {
                        reject(`ECHO ${ECHO_TEST_MSG} ERROR`)
                    }
                })
            })
        })

        let startCheckId = 0 // 全局启动任务标识
        const asyncStartSecretLocalYakEngineServer = async (win, params, attempt = 1, maxRetry = 3) => {
            const checkId = ++startCheckId
            const {version, port, password, isEnpriTraceAgent, isIRify} = params

            return new Promise((resolve, reject) => {
                engineLogOutputFileAndUI(win, `----- 启动本地引擎进程 (Random Local Password, Port: ${port})  -----`)
                let dbFile = null
                if (isIRify) {
                    dbFile = ["--profile-db", "irify-profile-rule.db", "--project-db", "default-irify.db"]
                }

                try {
                    const grpcParams = [
                        "grpc",
                        "--local-password",
                        password,
                        "--frontend",
                        `${version || "yakit"}`,
                        "--port",
                        port
                    ]
                    const extraParams = dbFile ? [...grpcParams, ...dbFile] : grpcParams
                    const resultParams = isEnpriTraceAgent ? [...extraParams, "--disable-output"] : extraParams

                    const command = getLocalYaklangEngine()
                    engineLogOutputFileAndUI(win, `启动命令: ${command} ${resultParams.join(" ")}`)

                    const subprocess = childProcess.spawn(command, resultParams, {
                        detached: false,
                        windowsHide: true,
                        stdio: ["ignore", "pipe", "pipe"],
                        env: {...process.env, YAKIT_HOME: YakitProjectPath}
                    })

                    subprocess.unref()

                    let stdout = ""
                    let stderr = ""
                    let successDetected = false
                    let killed = false
                    const timeoutMs = 5000

                    const timeoutId = setTimeout(() => {
                        if (successDetected || killed) return
                        killed = true
                        subprocess.kill()
                        try {
                            if (process.platform === "win32") {
                                childProcess.exec(`taskkill /PID ${subprocess.pid} /T /F`)
                            } else {
                                process.kill(subprocess.pid, "SIGKILL")
                            }
                        } catch {}
                        engineLogOutputFileAndUI(win, `----- 启动本地引擎超时 (5s) -----`)
                        reject({status: "timeout", message: "启动本地引擎超时"})
                    }, timeoutMs)

                    subprocess.stdout.on("data", (data) => {
                        if (checkId !== startCheckId) return
                        const output = data.toString("utf-8")
                        stdout += output
                        engineLogOutputFileAndUI(win, output)

                        if (/yak grpc ok/i.test(output)) {
                            successDetected = true
                            clearTimeout(timeoutId)
                            engineLogOutputFileAndUI(win, `检测到 'yak grpc ok'，引擎启动成功！`)
                            resolve({status: "success", message: "引擎启动成功"})
                        }
                    })

                    subprocess.stderr.on("data", (data) => {
                        if (checkId !== startCheckId) return
                        const output = data.toString("utf-8")
                        stderr += output
                        engineLogOutputFileAndUI(win, output)
                    })

                    subprocess.on("error", (err) => {
                        if (checkId !== startCheckId) return
                        clearTimeout(timeoutId)
                        engineLogOutputFileAndUI(win, `启动引擎出错: ${err.message}`)
                        win.webContents.send("start-yaklang-engine-error", `本地引擎遭遇错误，错误原因为：${err}`)
                        reject({status: "process_error", message: err.message})
                    })

                    subprocess.on("close", (code) => {
                        if (checkId !== startCheckId || killed || successDetected) return
                        clearTimeout(timeoutId)
                        engineLogOutputFileAndUI(win, `----- 引擎进程退出，退出码: ${code} -----`)
                        reject({status: "exit", message: `引擎进程提前退出 (${code})`})
                    })
                } catch (e) {
                    reject({status: "exception", message: e.message || String(e)})
                }
            }).catch(async (err) => {
                // 超时或异常重试
                // if (attempt < maxRetry && (err.status === "timeout" || err.status === "exit")) {
                //     const nextAttempt = attempt + 1
                //     engineLogOutputFileAndUI(
                //         win,
                //         `----- 启动失败 (${err.status})，将在 1 秒后重试 (${nextAttempt}/${maxRetry}) -----`
                //     )
                //     await new Promise((r) => setTimeout(r, 1000))
                //     return asyncStartSecretLocalYakEngineServer(win, params, nextAttempt, maxRetry)
                // }

                return Promise.reject({ok: false, ...err})
            })
        }
        ipcMain.handle(ipcEventPre + "start-secret-local-yaklang-engine", async (e, params) => {
            try {
                const result = await asyncStartSecretLocalYakEngineServer(win, params)
                return {ok: true, ...result}
            } catch (err) {
                const safeError = typeof err === "object" && err !== null ? err : {message: String(err)}
                return {
                    ok: false,
                    status: safeError.status || "unknown",
                    message: safeError.message || "未知错误"
                }
            }
        })
    }
}
