import colors from "kleur";

export type LoggerConfig = {
    silent?: boolean
    prefix?: boolean
}

const sparklesIcon = "✨ "
const errorIcon = "❌ "
const okIcon = "✔️"

function prefix(enable?: boolean) {
    return enable ? " [reactive-forge]" : ""
}

export function createLogger(config: LoggerConfig) {
    function info(message: string, done?: boolean) {
        if (config.silent) return
        console.info(`${done ? okIcon : sparklesIcon}${prefix(config.prefix)} ${message}`)
    }

    function error(message: string) {
        console.error(`${errorIcon}${prefix(config.prefix)} ${colors.red(message)}`)
    }

    function timing(message: string, done?: boolean) {
        const start = performance.now()
        return (_message = message, _done = done) => {
            const end = performance.now()
            const ms = end - start
            info(`${_message} ${colors.gray(`${ms.toFixed(2)}ms`)}`, _done)
        }
    }

    return {
        info,
        error,
        timing
    }
}

export type Logger = ReturnType<typeof createLogger>