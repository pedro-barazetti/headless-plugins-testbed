console.clear = () => console.log('Console was cleared')

;(() => {
    const patchTurnstile = (turnstile) => {
        if (!turnstile || typeof turnstile.render !== 'function' || turnstile.__capturePatched) {
            return
        }

        Object.defineProperty(turnstile, '__capturePatched', {
            value: true,
            configurable: true,
        })

        turnstile.render = (container, options = {}) => {
            const params = {
                sitekey: options.sitekey,
                pageurl: window.location.href,
                data: options.cData,
                pagedata: options.chlPageData,
                action: options.action,
                userAgent: navigator.userAgent,
                json: 1,
            }
            console.log('intercepted-params:' + JSON.stringify(params))
            window.cfCallback = options.callback

            // Some invisible integrations retain and later execute this id.
            return `captured-${Date.now()}`
        }
    }

    let turnstileValue = window.turnstile
    try {
        Object.defineProperty(window, 'turnstile', {
            configurable: true,
            enumerable: true,
            get: () => turnstileValue,
            set: (value) => {
                turnstileValue = value
                patchTurnstile(value)
            },
        })
    } catch {
        // Fall back to the short poll below if the property cannot be redefined.
    }

    patchTurnstile(turnstileValue)
    setInterval(() => patchTurnstile(window.turnstile), 10)
})()
