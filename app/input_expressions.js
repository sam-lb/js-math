

const { tracker } = require("../parsing/errors.js");
const { Token } = require("../parsing/pratt/token");
const { TokenType } = require("../parsing/pratt/tokentype.js");
const { scope } = require("./scope.js");



class PlottableType {
    static NUMBER = 0; // point
    static DOMAIN = 1; // something that can be shown as a domain coloring
    static PARAMETRIC = 2;
    static NONE = 3; // no way to plot, e.g. functions of more than one variable
}


class InputExpression {

    constructor(tokens, id) {
        this.tokens = tokens;
        this.id = id;
        this.findRequirements();
        this.readTokens();
    }

    findRequirements() {
        this.requirements = [];
    }

    readTokens() {
        
    }

}


class FunctionDefinition extends InputExpression {

    constructor(tokens, id) {
        super(tokens, id);
    }

    findRequirements() {
        this.requirements = [];
        this.locals = [];
        if (this.tokens[0]?.mtype !== TokenType.NAME) {
            tracker.error("Function definition does not begin with valid identifier");
            return;
        } else {
            this.name = this.tokens[0].text;
        }

        let assignmentEncountered = false;
        for (const token of this.tokens.slice(1, this.tokens.length)) {
            if (token.mtype === TokenType.ASSIGN) {
                assignmentEncountered = true;
                continue;   
            }

            if (token.mtype === TokenType.NAME && !scope.builtin[token.text]) {
                console.log(token.text, ":Reahg");
                if (assignmentEncountered && !this.locals.includes(token.text)) {
                    this.requirements.push(token.text);
                } else if (!assignmentEncountered) {
                    this.locals.push(token.text);
                }
            }
        }
    }

    readTokens() {
        this.name = null;
        this.arguments = {
            arg1: "type1",
        };
        this.definition = null;
        // this.ast = parse(this.tokens);
    }

}


class VariableDefinition extends InputExpression {

    constructor(tokens, id) {
        super(tokens, id);
    }

    findRequirements() {
        this.requirements = [];
    }

    readTokens() {
        this.name = null;
        this.definition = null;
        this.sliderable = false;
        this.type = "type";
    }

}


class EvaluatableLine extends InputExpression {

    constructor(tokens, id) {
        super(tokens, id);
    }

    findRequirements() {
        this.requirements = [];
    }

    readTokens() {
        this.type = null;
        this.plottableType = null;
    }

}


module.exports = {
    FunctionDefinition,
    VariableDefinition,
    EvaluatableLine,
};