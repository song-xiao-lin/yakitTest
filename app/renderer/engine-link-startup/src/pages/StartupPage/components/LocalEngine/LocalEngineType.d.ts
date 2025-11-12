import React, {Dispatch, SetStateAction} from "react"

export interface LocalEngineProps {
    ref?: React.ForwardedRef<LocalEngineLinkFuncProps>
    setLog: Dispatch<SetStateAction<string[]>>
    onLinkEngine: (params: LocalLinkParams) => void
    setYakitStatus: (v: YakitStatusType) => void
}

export interface LocalEngineLinkFuncProps {
    /** 初始化并检查所有前置项后的本地连接 */
    init: (port: number) => void
    /** 检查引擎版本后的本地连接 */
    link: (port: number) => void
    /** 引擎版本问题后的内置版本解压弹框确认 */
    resetBuiltIn: () => void
}

export interface AllowSecretLocal {
    addr: string
    host: string
    ok: boolean
    port: number
    reason: string
    secret: string
    version: string
}

export interface LocalLinkParams {
    port: number
    secret?: string
}

export interface CheckAllowSecretLocal {
    ok: boolean
    status: string
    message: string
    json: null | AllowSecretLocal
}
