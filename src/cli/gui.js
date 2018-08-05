/**
 * @fileoverview The CLI GUI.
 * Handles formatting the state of a (multifile) linting in a human-friendly way.
 * Expects a terminal to be present as process.stdout.
 */
const logUpdate = require("log-update");
const Logger = require("../lib/logger");
const logHistory = Logger.cliConsole;

const Separator = require("./components/separator");
const Log = require("./components/log");
const LintingDisplay = require("./components/linting");
const Summary = require("./components/summary");

/** @typedef {import("../lib/linting.js")} Linting */

module.exports = class GUI {
    constructor() {
        // subscribe to global logs
        Logger.setCLI(true);
        logHistory.on("msg", () => this.update());

        /** If true, we should only write to stdout once */
        this.ci = false;

        // generate one-shot components
        this.$titles = {
            log: new Separator("Log"),
            lints: new Separator("Files"),
            summary: new Separator("Summary"),
        };
        this.$log = new Log(logHistory);
        this.$summary = new Summary();
        /** @type {LintingDisplay[]} */
        this.$lintings = [];
    }

    /**
     * Called when the linting is finished and we should finish up.
     */
    finish() {
        if (this.ci) {
            console.log(this.render());
        } else {
            this.update(true);
        }
    }

    /**
     * Re-renders the GUI.
     * Should be called any time anything has changed.
     * @param {Boolean} force If true, don't debounce
     */
    update(force = false) {
        if (this.ci) { return; }
        clearTimeout(this._updateDebounce);
        this._lastUpdate = this._lastUpdate || 0;
        const cur = Date.now();
        const exceededTimeout = (cur - this._lastUpdate) > 50;
        if (exceededTimeout || force) {
            this._update();
        } else {
            this._updateDebounce = setTimeout(() => this._update(), 50);
        }
    }

    /**
     * Actually re-renders the GUI, without debouncing.
     * Shouldn't be called by an external user, unless they know what they're doing.
     */
    _update() {
        this._lastUpdate = Date.now();
        logUpdate(this.render());

        // animate if we should
        if (this.shouldAnimate()) {
            clearTimeout(this._animTimeout);
            this._animTimeout = setTimeout(() => this.update(), 100);
        }
    }

    /**
     * Returns the string that represents the GUI.
     * This string can be logged directly to console.
     */
    render() {
        const outp = [];
        if (logHistory.messages.length) {
            outp.push(
                "",
                this.$titles.log,
                this.$log
            );
        }
        if (this.$lintings.length) {
            let $lintings = this.$lintings.filter(
                $linting => $linting.linting.state !== $linting.linting.STATES.success
            );
            outp.push(
                "",
                this.$titles.lints,
                $lintings
                    .join("\n"),
            );
        }
        outp.push(
            "",
            this.$titles.summary,
            this.$summary
        );
        if (outp[0] === "") { outp.shift(); }
        return outp.join("\n");
    }

    /**
     * Returns whether we should animate actively (e.g. for a spinner)
     * @returns {Boolean}
     */
    shouldAnimate() {
        return this.$lintings.some($linting => $linting.shouldAnimate());
    }

    /**
     * Adds a Linting to the GUI.
     * This means that the result of the linting will be shown by the GUI.
     * @param {Linting} linting The linting to show
     */
    addLinting(linting) {
        this.$lintings.push(new LintingDisplay(linting));
        this.$summary.addLinting(linting);
        linting.on("rule", () => this.update());
        linting.on("done", () => this.update());
    }

    /**
     * Sets whether we should only output to stdout once.
     * @param {Boolean} value If true, enable CI mode
     */
    setCI(value) {
        this.ci = value;
    }
};
