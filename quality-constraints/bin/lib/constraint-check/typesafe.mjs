// Minimal HTTP client for System One. No SDK: one route, one verb, and `fetch` has been
// built in since Node 18 — a dependency here would cost more than it returns.

const ENDPOINT = 'https://api.typesafe.ai/v1/systemone'
const RETRYABLE = new Set([429, 500, 502, 503, 504, 529])

export class TypeSafeError extends Error {
    constructor(message, { status = null, body = null } = {}) {
        super(message)
        this.name = 'TypeSafeError'
        this.status = status
        this.body = body
    }
}

export class TypeSafeClient {
    constructor({
        apiKey = process.env.TYPESAFE_API_KEY,
        model = 'jev-latest',
        endpoint = ENDPOINT,
        maxRetries = 3,
        timeoutMs = 60_000,
    } = {}) {
        if (!apiKey) {
            throw new TypeSafeError('TYPESAFE_API_KEY is missing from the environment.')
        }
        this.apiKey = apiKey
        this.model = model
        this.endpoint = endpoint
        this.maxRetries = maxRetries
        this.timeoutMs = timeoutMs
        this.usage = { requests: 0, inputTokens: 0, outputTokens: 0 }
    }

    /**
     * @param {object|string} state                The state submitted to the model.
     * @param {Record<string, object>} questions   Independent questions, evaluated in parallel.
     */
    async systemOne(state, questions) {
        const payload = JSON.stringify({ model: this.model, state, questions })

        let lastError = null
        for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
            if (attempt > 0) {
                await sleep(backoffMs(attempt))
            }

            let response
            try {
                response = await fetch(this.endpoint, {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${this.apiKey}`,
                        'Content-Type': 'application/json',
                    },
                    body: payload,
                    signal: AbortSignal.timeout(this.timeoutMs),
                })
            } catch (error) {
                // Dropped connection or timeout: retry, it is the most transient class of failure.
                lastError = new TypeSafeError(`TypeSafe call failed: ${error.message}`)
                continue
            }

            const body = await readBody(response)

            if (response.ok) {
                this.#recordUsage(body)

                return body
            }

            lastError = new TypeSafeError(`TypeSafe answered ${response.status}: ${describe(body)}`, {
                status: response.status,
                body,
            })

            if (!RETRYABLE.has(response.status)) break
        }

        throw lastError
    }

    #recordUsage(body) {
        this.usage.requests += 1
        const usage = body?.usage ?? {}
        this.usage.inputTokens += usage.input_tokens ?? usage.inputTokens ?? 0
        this.usage.outputTokens += usage.output_tokens ?? usage.outputTokens ?? 0
    }
}

/** Runs the tasks with a concurrency ceiling, results kept in submission order. */
export async function mapWithConcurrency(items, limit, worker) {
    const results = new Array(items.length)
    let cursor = 0

    const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (cursor < items.length) {
            const index = cursor++
            results[index] = await worker(items[index], index)
        }
    })

    await Promise.all(runners)

    return results
}

async function readBody(response) {
    const text = await response.text()
    try {
        return JSON.parse(text)
    } catch {
        return text
    }
}

function describe(body) {
    if (typeof body === 'string') return body.slice(0, 400)

    return JSON.stringify(body ?? {}).slice(0, 400)
}

function backoffMs(attempt) {
    const base = 500 * 2 ** (attempt - 1)

    return base + Math.floor(Math.random() * 250)
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
}
