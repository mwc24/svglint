/**
 * @fileoverview The main linting file.
 * This is the object responsible for the actual linting of each file.
 * Each instance represents a single file being linted, including results and
 *   current state.
 * It receives the parsed AST and rules from ../svglint.js, and then runs each
 *   rule and gathers the results.
 */
const EventEmitter = require("events").EventEmitter;
const path = require("path");
const Reporter = require("./reporter");
const Logger = require("./logger");

const STATES = Object.freeze({
    "ignored": "ignored",
    "linting": "linting",
    "success": "success",
    "warn":    "warn",
    "error":   "error",
});

/**
 * Represents a single file that is being linted.
 * Contains the status and potential result of the linting.
 * @event rule Emitted when a rule is finished
 * @event done Emitted when the linting is done
 */
class Linting extends EventEmitter {
    /**
     * Creates and starts a new linting.
     * @param {String} file The file to lint
     * @param {AST} ast The AST of the file
     * @param {NormalizedRules} rules The rules that represent 
     */
    constructor(file, ast, rules) {
        super();
        /** The AST of the file */
        this.ast = ast;
        /** The rules we use for linting */
        this.rules = rules;
        /** The path to the file */
        this.path = file;
        /** The current state of the linting */
        this.state = STATES.linting;
        /** If false, the linting has at least one rule that errored when executing */
        this.valid = true;
        /** The name used for logging/human consumption */
        this.name = file
            ? path.relative(process.cwd(), file)
            : "API";
        /** The Reporters for each rule we've linted
         * @type Object<string,Reporter|Reporter[]> */
        this.results = {};
        /** The logger used to show debugs */
        this.logger = Logger(`lint:${this.name}`);

        this.lint();
    }

    /**
     * Starts the linting.
     * Errors from rules are safely caught and logged as exceptions from the rule.
     */
    lint() {
        this.state = STATES.linting;

        // keep track of when every rule has finished
        const ruleNames = Object.keys(this.rules);
        this.activeRules = ruleNames.length;

        this.logger.debug("Started linting");
        this.logger.debug("  Rules:", ruleNames);

        // start every rule
        ruleNames.forEach(ruleName => {
            /**
             * Executes a rule function.
             * @param {Function} rule The loaded rule
             * @param {String} reporterName The name to give the reporter
             * @param {Function} onDone Function to call once the rule is done
             */
            const execute = (rule, reporterName, onDone) => {
                // gather results from the rule through a reporter
                const reporter = this._generateReporter(reporterName);
                // execute the rule, potentially waiting for async rules
                // also handles catching errors from the rule
                Promise.resolve()
                    .then(() => rule(reporter))
                    .catch(e => reporter.exception(e))
                    .then(() => onDone(reporter));
            };

            /** @type {Function|Function[]} */
            const rule = this.rules[ruleName];
            this.logger.debug("Got rule", ruleName, rule);
            if (rule instanceof Array) {
                // TODO: implement handling of multi-config rules
                /** @type {Reporter[]} */
                const results = [];
                let activeRules = rule.length;
                rule.forEach((r, i) => {
                    execute(r, `${ruleName}-${i+1}`, result => {
                        results[i] = result;
                        if (--activeRules <= 0) {
                            this._onRuleFinish(ruleName, results);
                        }
                    });
                });
            } else {
                execute(rule, ruleName, result => {
                    this._onRuleFinish(ruleName, result);
                });
            }
        });
    }

    /**
     * Handles a rule finishing.
     * @param {String} ruleName The name of the rule that just finished
     * @param {Reporter|Reporter[]} reporter The reporter containing rule results
     * @emits rule
     * @private
     */
    _onRuleFinish(ruleName, reporter) {
        this.logger.debug("Rule finished", Logger.colorize(ruleName));
        this.emit("rule", {
            name: ruleName,
            result: reporter,
        });
        this.results[ruleName] = reporter;

        --this.activeRules;
        if (this.activeRules === 0) {
            this.state = this._calculateState();
            this.logger.debug("Linting finished", Logger.colorize(this.state));
            this.emit("done");
        }
    }

    /**
     * Calculates the current state from this.results.
     * @returns One of the valid states
     */
    _calculateState() {
        let state = STATES.success;
        for (let k in this.results) {
            const result = this.results[k];
            if (result instanceof Array) {
                if (result.some(res => res.errors.length > 0)) {
                    return STATES.error;
                }
                if (result.some(res => res.warns.length > 0)) {
                    state = STATES.warn;
                }
            } else {
                if (result.errors.length > 0) {
                    return STATES.error;
                }
                if (result.warns.length > 0) {
                    state = STATES.warn;
                }
            }
        }
        return state;
    }

    /**
     * Generates a Reporter for use with this file.
     * Remember to call .done() on it.
     * @param {String} ruleName The name of the rule that this reporter is used for
     * @returns {Reporter} The generated reporter
     * @private
     */
    _generateReporter(ruleName) {
        const reporter = new Reporter(ruleName);
        reporter.once("exception", () => {
            this.valid = false;
        });
        return reporter;
    }
}
Linting.STATES = STATES;

module.exports = Linting;
