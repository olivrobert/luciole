// Builds the Noul questions sent to System One, and turns the returned probabilities into
// verdicts. One rule yields two independent questions:
//
//   t<i> — is the rule's trigger present in this file?
//   c<i> — does every relevant occurrence comply with the rule?
//
// Compliance is asked positively, and the violation probability is its complement. Asking
// "does this file break the rule?" stacks a negation onto statements that are already
// negative ("MUST NOT: the handler does not depend on the EntityManager"), and the model
// fired on compliant files.
//
// Both travel in the same request, over the same state: they are evaluated in parallel and
// cannot see each other. Code recomposes the verdict.

/** @returns {Record<string, object>} questions keyed by `t<i>` / `c<i>`. */
export function buildQuestions(rules) {
    const questions = {}

    rules.forEach((rule, index) => {
        if (rule.trigger) {
            questions[`t${index}`] = triggerQuestion(rule)
        }
        questions[`c${index}`] = complianceQuestion(rule)
    })

    return questions
}

function triggerQuestion(rule) {
    return {
        type: 'noul',
        instructions: `Does the code in this file exhibit the following situation: ${rule.trigger}?`,
        criteria: {
            true: `The described situation does occur in this file: the quality rule applies to it.`,
            false: `The described situation is absent from this file: the quality rule does not apply, even though the file is of the right kind.`,
        },
    }
}

function complianceQuestion(rule) {
    // The anchor says WHERE to look and what correct code looks like there — it is not a
    // string to find. Several anchors end in illustrative names ("(confirmLabel,
    // imagePriority, mobileWidths)"); read as a checklist, they made the model fail every
    // file that did not literally contain them.
    const anchor = rule.anchor
        ? `Where to look, and what correct code looks like there: ${rule.anchor}.`
        : `No location is given: judge the statement against the code as written.`

    // The trigger defines the population being judged, so it has to be restated here. Without
    // it the model judged a Twig template's CSS classes and `{% set %}` variables against a
    // rule that only governs the `{% props %}` block, and fired on 10 compliant files out of 11.
    const scope = rule.trigger
        ? `Judge only the occurrences of: ${rule.trigger}. Anything else in the file is outside this rule, however similar it looks.`
        : `Judge the file as a whole.`

    return {
        type: 'noul',
        instructions:
            `Coding rule enforced on this codebase: ${rule.severity}: ${rule.statement}. ${anchor} ${scope} ` +
            `Does every occurrence the rule covers comply with it?`,
        criteria: {
            true: `Every occurrence the rule covers complies with it. A name or a value that has no need of the convention still satisfies it: a single lowercase word is valid lowerCamelCase and valid snake_case alike, a one-letter value is valid either way, an empty body satisfies a rule about what a body contains. Answer yes too when the rule covers nothing in this file, and when the code is merely unusual but still within the rule. Any identifier, path or snippet quoted above only illustrates the correct form — it is not a list of strings this file must contain, and its absence is not a breach.`,
            false: `At least one occurrence the rule covers plainly departs from it: you could quote the exact line and name what is wrong with it. A borderline or arguable reading is not a departure.`,
        },
    }
}

/**
 * Turns one file's answers into per-rule verdicts.
 *
 * @returns {Array<{index: number, status: 'violation'|'uncertain'|'clean'|'skipped', trigger: number|null, violation: number|null}>}
 */
export function readAnswers(answers, rules, { violationThreshold, triggerThreshold, uncertainThreshold }) {
    return rules.map((rule, index) => {
        const trigger = rule.trigger ? noulValue(answers?.[`t${index}`], `t${index}`) : null
        const compliance = noulValue(answers?.[`c${index}`], `c${index}`)

        const violation = 1 - compliance

        // The trigger is a guard rail: below its threshold the rule does not apply to the
        // file, and the violation probability no longer means anything.
        if (trigger !== null && trigger < triggerThreshold) {
            return { index, status: 'skipped', trigger, violation }
        }

        if (violation >= violationThreshold) {
            return { index, status: 'violation', trigger, violation }
        }

        if (violation >= uncertainThreshold) {
            return { index, status: 'uncertain', trigger, violation }
        }

        return { index, status: 'clean', trigger, violation }
    })
}

function noulValue(answer, id) {
    const value = typeof answer === 'number' ? answer : answer?.noul ?? answer?.value
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
        throw new Error(`Missing or invalid Noul answer ${id}: expected a probability between 0 and 1`)
    }
    return value
}
