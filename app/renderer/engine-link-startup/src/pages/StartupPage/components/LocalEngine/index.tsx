import {forwardRef, memo, useImperativeHandle, useRef} from "react"
import {AllowSecretLocal, LocalEngineProps} from "./LocalEngineType"
import {useMemoizedFn} from "ahooks"
import {debugToPrintLog} from "@/utils/logCollection"
import {grpcCheckAllowSecretLocal} from "../../grpc"

export const LocalEngine: React.FC<LocalEngineProps> = memo(
    forwardRef((props, ref) => {
        const {setLog, onLinkEngine, setYakitStatus} = props
        const allowSecretLocalJson = useRef<AllowSecretLocal>(null)

        const handleAllowSecretLocal = useMemoizedFn(async (port: number) => {
            setLog(["开始检查随机密码模式支持中..."])
            const res = await grpcCheckAllowSecretLocal(port)
            if (res.ok && res.status === "success") {
                setLog((arr) => arr.concat(["检查通过，已支持随机密码模式"]))
                setYakitStatus("")
                allowSecretLocalJson.current = res.json
                await continueCheck()
                return
            }
            allowSecretLocalJson.current = null
            switch (res.status) {
                case "timeout":
                    setLog((arr) => arr.concat(["命令执行超时，可查看日志详细信息..."]))
                    setYakitStatus("check_timeout")
                    break
                case "old_version":
                    setLog((arr) => arr.concat(["当前引擎版本过旧，不支持随机密码模式"]))
                    setYakitStatus("old_version")
                    break
                case "port_occupied":
                    setLog((arr) => arr.concat(["端口不可用，可查看日志报错信息进行处理..."]))
                    setYakitStatus("port_occupied")
                    break
                case "antivirus_blocked":
                    setLog((arr) => arr.concat(["检测失败，可能被杀软或防火墙拦截"]))
                    setYakitStatus("antivirus_blocked")
                    break
                default:
                    setLog((arr) =>
                        arr.concat(["无法启动，可将日志信息发送给工作人员处理", `未知错误：${res.message || "无"}`])
                    )
                    setYakitStatus("allow-secret-error")
            }
        })

        const continueCheck = useMemoizedFn(async () => {
            try {
                if (allowSecretLocalJson.current) {
                    debugToPrintLog(`------ 准备开始启动引擎逻辑 ------`)
                    setLog([`引擎版本号——${allowSecretLocalJson.current.version}`, "准备开始本地连接中"])
                    setTimeout(() => {
                        onLinkEngine({
                            port: allowSecretLocalJson.current.port,
                            secret: allowSecretLocalJson.current.secret
                        })
                    }, 1000)
                }
            } catch (err) {}
        })

        // 启动 yakit 后的连接引擎
        const initLink = useMemoizedFn((port: number) => {
            handleAllowSecretLocal(port)
        })

        // 检查引擎版本后的本地连接
        const toLink = useMemoizedFn((port: number) => {
            handleAllowSecretLocal(port)
        })

        // 重置内置引擎的确认弹框
        const resetBuiltIn = useMemoizedFn(() => {})

        useImperativeHandle(
            ref,
            () => ({
                init: initLink,
                link: toLink,
                resetBuiltIn: resetBuiltIn
            }),
            []
        )

        return <></>
    })
)
