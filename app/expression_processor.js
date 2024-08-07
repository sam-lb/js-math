

/**
 * Goal: classify each expression as a certain type of InputExpression
 * this will make it easier to decide which additional UI components each line needs
 * (such as sliders, rendering options)
 */


const { scope } = require("./scope.js");
const { tracker } = require("../parsing/errors.js");
const {
    AssignExpression, CallExpression, NameExpression,
    OperatorExpression, PrefixExpression
} = require("../parsing/pratt/expressions.js");
const { TokenType } = require("../parsing/pratt/tokentype.js");
const { Lexer } = require("../parsing/pratt/lexer.js");
const { ExpressionParser } = require("../parsing/pratt/expression_parser.js");
const {
    FunctionDefinition, VariableDefinition,
    EvaluatableLine,
} = require("./input_expressions.js");
const { cleanLatex } = require("../parsing/latex_convert.js");


function populateGlobalUserScope(fields) {
    const lexer = new Lexer(null, true);
    // intentionally NOT setting the lexer's scope here
    const functionAssignments = {};

    for (const id in fields) {
        const callbacks = getCallbacks(id);
        tracker.setCallback(callbacks.callback);
        tracker.setSuccessCallback(callbacks.successCallback);
        const field = fields[id];
        const latex = cleanLatex(field.field.latex());

        if (!latex.includes("=")) continue;

        lexer.setText(latex);
        lexer.tokenize();
        if (tracker.hasError) return null;
        const tokens = lexer.getTokens();
        const name = tokens[0];

        if (!(name.mtype === TokenType.NAME)) {
            tracker.error("Invalid assignment: left hand side must begin with identifier");
            return null;
        }

        if (!(scope.builtin[name.text] === undefined)) {
            tracker.error(`Cannot overwrite builtin ${name.text}`);
            return null;
        }

        const second = tokens[1]; // not undefined since there's at least an identifier and = at this point
        if (second.mtype === TokenType.ASSIGN) {
            scope.userGlobal[name.text] = {
                isFunction: false,
                shaderAlias: "udf_" + name.text,
            };
        } else if (second.mtype === TokenType.ASTERISK && tokens[2]?.mtype === TokenType.LEFT_PAREN) {
            // account for implicit multiplication
            tokens.splice(1, 1);
            scope.userGlobal[name.text] = {
                isFunction: true,
                shaderAlias: "udf_" + name.text,
            };
            functionAssignments[name.text] = {
                tokens,
                id
            };
        } else {
            tracker.error("Invalid assignment: left hand side must be identifier or function with argument list");
            return null;
        }
    }

    return functionAssignments;
}

function populateLocalUserScopes(functionAssignments) {
    // specify local variables for functions
    for (const name in functionAssignments) {
        const callbacks = getCallbacks(functionAssignments[name].id);
        tracker.setCallback(callbacks.callback);
        tracker.setSuccessCallback(callbacks.successCallback);
        const assignment = [];
        for (const token of functionAssignments[name].tokens) {
            if (token.text === "=") break;
            assignment.push(token);
        }
        const locals = {};
        const ast = (new ExpressionParser(assignment)).parseExpression();
        if (tracker.hasError) return null;
        if (!(ast instanceof CallExpression)) {
            tracker.error("Invalid assignment"); // not a lot of detail in the error message because it's not clear when this might happen
            return null;
        }

        const args = ast.mArgs;
        const index = 0;
        for (const arg of args) {
            let argName;
            if (arg instanceof NameExpression) {
                // argument without type spec
                argName = arg.mName;
            } else if (arg instanceof OperatorExpression && arg.mOperator === TokenType.COLON) {
                // argument with type spec
                // ignore type for now, since only valid type is complex
                argName = arg.mLeft.mName;
            } else {
                tracker.error(`Invalid argument ${arg.toString()}`);
                return null;
            }

            if (Object.keys(scope.builtin).includes(argName) && !scope.builtin[argName].isParameter) {
                tracker.error(`Cannot locally overwrite builtin identifier ${argName}`);
                return null;
            } else if (Object.keys(scope.userGlobal).includes(argName)) {
                tracker.error(`Cannot locally overwrite globally defined identifier ${argName}`);
                return null;
            }

            locals[argName] = {
                isFunction: false,
                type: "complex",
                index: index,
            };
        }

        scope.userGlobal[name]["locals"] = locals;
    }
    return 1;
}


function populateUserScope(fields) {
    scope.userGlobal = {};
    for (const id in fields) {
        const callbacks = getCallbacks(id);
        tracker.setCallback(callbacks.callback);
        tracker.setSuccessCallback(callbacks.successCallback);
        tracker.clear();
    }

    const functionAssignments = populateGlobalUserScope(fields);
    if (functionAssignments === null) return;
    const success = populateLocalUserScopes(functionAssignments);
    if (success === null) return;
}

function classifySliderInput(sliderFields) {
    const lexer = new Lexer(null, false);
    lexer.setScope(scope);

    const results = [];

    for (const id in sliderFields) {
        const callbacks = getCallbacks(id);
        tracker.setCallback(callbacks.callback);
        tracker.setSuccessCallback(callbacks.successCallback);

        const minField = sliderFields[id].min;
        const maxField = sliderFields[id].max;

        const minLatex = cleanLatex(minField.latex()), maxLatex = cleanLatex(maxField.latex());

        if (minLatex.includes("=") || maxLatex.includes("=")) {
            tracker.error("Assignments are not allowed in slider bound fields!");
            return;
        }

        lexer.setText(minLatex);
        lexer.tokenize();
        const minTokens = lexer.getTokens();

        lexer.setText(maxLatex);
        lexer.tokenize();
        const maxTokens = lexer.getTokens();

        results.push([
            new EvaluatableLine(minTokens, id),
            new EvaluatableLine(maxTokens, id),
        ]);
    }

    return results;
}

function classifyInput(fields) {
    const lexer = new Lexer(null, false);
    lexer.setScope(scope);
    const inputExpressions = {
        "functions": [],
        "variables": [],
        "evaluatables": [],
    };

    for (const id in fields) {
        const callbacks = getCallbacks(id);
        tracker.setCallback(callbacks.callback);
        tracker.setSuccessCallback(callbacks.successCallback);
        const field = fields[id];
        const latex = cleanLatex(field.field.latex());
        if (latex === "") {
            // skip empty lines
            continue;
        }
        lexer.setText(latex);
        lexer.tokenize();
        const tokens = lexer.getTokens();

        if (latex.includes("=")) {
            if (tokens[1]?.mtype === TokenType.LEFT_PAREN) {
                // re-tokenize with local scope
                lexer.setText(latex);
                lexer.setLocalScope(scope.userGlobal[tokens[0].text].locals);
                lexer.tokenize();
                inputExpressions["functions"].push(new FunctionDefinition(lexer.getTokens(), id));
            } else {
                inputExpressions["variables"].push(new VariableDefinition(tokens, id));
            }
        } else {
            inputExpressions["evaluatables"].push(new EvaluatableLine(tokens, id));
        }
    }

    return inputExpressions;
}

function allRequirementsSatisfied(lines, names) {
    if (lines.some(line => {
        const callbacks = getCallbacks(line.id);
        tracker.setCallback(callbacks.callback);
        tracker.setSuccessCallback(callbacks.successCallback);
        for (const req of line.requirements) {
            if (!names.includes(req)) {
                if (scope.builtin[req]?.isParameter && line instanceof VariableDefinition) {
                    tracker.error("Nah💀💀 you really thought you could do wackscopes get well-defined syntaxed bozo");
                } else {
                    tracker.error(`Unbound variable ${req}`);
                }
                return true;
            }
        }
        return false;
    })) {
        return false;
    }

    return true;
}

function noInvalidRequirements(varsAndFuncs, lines) {
    // check that there are no circular requirements (including self requirements)
    // check that there are no repeated definitions
    for (const line of varsAndFuncs) {
        const callbacks = getCallbacks(line.id);
        tracker.setCallback(callbacks.callback);
        tracker.setSuccessCallback(callbacks.successCallback);
        for (const req of line.requirements) {
            const definitions = lines.filter(def => def.name === req);
            if (definitions.length > 1) {
                tracker.error(`Multiple defintions found for ${req}`);
                return false;
            }
            const definition = definitions[0];
            if (definition.requirements.includes(line.name)) {
                tracker.error(`Circular definition: ${req}, ${line.name}`);
                return false;
            }
        }
    }

    return true;
}

function noRepeatDefinitions(names) {
    if (!(Array.from(new Set(names)).length === names.length)) {
        tracker.error("Repeated definitions");
        return false;
    }
    return true;
}

function validateLines(lines) {
    const varsAndFuncs = lines["functions"].concat(lines["variables"]);
    const allLines = Array.prototype.concat(lines["functions"], lines["variables"], lines["evaluatables"]);
    const names = varsAndFuncs.map(line => line.name);

    if (!allRequirementsSatisfied(allLines, names)) return false;
    if (!noInvalidRequirements(varsAndFuncs, allLines)) return false;
    if (!noRepeatDefinitions(names)) return false;

    return true;
}


function validateAST(ast) {
    if (
        ast instanceof AssignExpression ||
        ast instanceof OperatorExpression
    ) {
        validateAST(ast.mLeft);
        if (tracker.hasError) return;
        validateAST(ast.mRight);
    } else if (ast instanceof PrefixExpression) {
        validateAST(ast.mRight);
    } else if (ast instanceof CallExpression) {
        // Validate argument count (and later, type);
        let requiredArgCount;
        if (scope.userGlobal[ast.mFunction]?.locals) {
            requiredArgCount = Object.keys(scope.userGlobal[ast.mFunction].locals).length;
        } else {
            requiredArgCount = Object.keys(scope.builtin[ast.mFunction].locals).length;
        }
        const passedArgCount = ast.mArgs.length;
        if (requiredArgCount !== passedArgCount) {
            tracker.error(`Wrong number of arguments passed to ${ast.mFunction} (expected ${requiredArgCount}, received ${passedArgCount})`);
            return;
        }
        for (const arg of ast.mArgs) {
            validateAST(arg);
            if (tracker.hasError) return;
        }
    }
}


module.exports = {
    classifyInput,
    classifySliderInput,
    validateLines,
    populateUserScope,
    validateAST,
};