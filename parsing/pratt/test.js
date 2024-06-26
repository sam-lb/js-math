

document.querySelector("#minput-field").focus();


`
h(x:complex)=1/(2+x)*g(x)+mx+b
g(y)=y^2+y
m=4
b=3
r=h(x)
`;

const scope = {
    builtin: {
        "x": { isFunction: false, },
        "y": { isFunction: false, },
        "xy": { isFunction: false, },
        "x1": { isFunction: false, },
        /* datatypes (for type annotation) */
        "complex": { isFunction: false, },
        "array": { isFunction: false, },
        "matrix": { isFunction: false, },
        "function": { isFunction: false, },
    },
    userGlobal: {
        "f": { isFunction: true, },
    },
}


function handleKeydown() {
    if (window.event.keyCode === 13) {
        handleSubmit();
    }
}


function handleSubmit() {
    const latex = document.querySelector("#minput-field").value;
    const text = cleanLatex(latex);

    tracker.setTarget("error-output");
    tracker.setCallback(() => console.log(tracker.message));
    tracker.clear();

    const lexer = new Lexer(text, false);
    lexer.setScope(scope);
    
    lexer.tokenize();
    const tokens = lexer.getTokens();

    if (tracker.hasError) {
        console.error("error occurred during tokenization");
    } else {
        tracker.clear();
        console.log("Tokens: ", tokens);

        const parser = new ExpressionParser(tokens);
        const result = parser.parseExpression();

        if (tracker.hasError) {
            console.error("error occurred during parsing");
        } else {
            console.log("AST:\n\n", result, "\n\n"+result.toString());
        }
    }
}


function handleSubmitMultiline() {
    const expressions = document.querySelector("#minput-multiline-field").innerText.split("\n").filter((line) => line.length > 0);
    console.log(expressions);
    processExpressions(expressions);
}


function processExpressions(latexExprs) {
    tracker.setTarget("multiline-error-output");
    tracker.clear();

    const exprs = [];
    for (const latexExpr of latexExprs) {
        exprs.push(cleanLatex(latexExpr));
    }

    const assignments = [];
    for (const expr of exprs) {
        if (expr.includes("=")) {
            assignments.push(expr);
        }
    }
    
    const lexer = new Lexer(null, true);
    lexer.setScope(scope);
    for (const assignment of assignments) {
        lexer.setText(assignment);
        lexer.tokenize();
        const tokens = lexer.getTokens();
        console.log(tokens);

        const parser = new ExpressionParser(tokens);
        const result = parser.parseExpression();

        console.log(result);
        console.log(result?.toString());
        
        if (result !== undefined) {
            const left = result.mLeft;
            const isFunction = left instanceof CallExpression;
            const ident = (isFunction) ? left.mFunction : left.mName;
            if (scope.builtin[ident] !== undefined) {
                tracker.error(`cannot overwrite builtin identifier ${ident}`);
            } else if (scope.userGlobal[ident] !== undefined) {
                tracker.error(`multiple definitions for ${ident}`);
            } else {
                scope.userGlobal[ident] = {
                    isFunction: isFunction,
                }
            }
        }

        if (tracker.hasError) break;

        // tracker.setTarget(current expression id)
    }

    const asts = [];
    if (!tracker.hasError) {
        lexer.setScope(scope); // the scope may have changed, so it doesn't hurt to do this explicitly
        lexer.setAllowUnboundIdentifiers(false);
        for (const expr of exprs) {
            lexer.setText(expr);
            lexer.tokenize();
            const tokens = lexer.getTokens();

            const parser = new ExpressionParser(tokens);
            const result = parser.parseExpression();
            asts.push(result);
        }
    }

    if (tracker.hasError) {
        document.querySelector("#multiline-parser-output").innerText = "";    
    } else {
        let astStrings = "";
        for (const ast of asts) {
            astStrings += parenthesis_match(ast.toString());
            astStrings += "<br/>";
        }
        astStrings = astStrings.slice(0, -1);
        document.querySelector("#multiline-parser-output").innerHTML = `parser output:<br>${astStrings}`;
    }
}


const multilines = document.querySelectorAll(".multiline-input");
for (const multi of multilines) {
    multi.contentEditable = true;
}