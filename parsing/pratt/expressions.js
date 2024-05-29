


class Expression {

}


class AssignExpression extends Expression {

    constructor(name, left) {
        super();
        this.mName = name;
        this.mLeft = left;
    }

    toString() {
        return `(${this.mName} = ${this.mLeft.toString()})`
    }

}


class CallExpression extends Expression {

    constructor(func, args) {
        super();
        this.mFunction = func;
        this.mArgs = args;
    }

    toString() {
        const args = this.mArgs.join();
        return `${this.mFunction.toString()}(${args})`;
    }

}


class NameExpression extends Expression {

    constructor(name) {
        super();
        this.mName = name;
    }

    toString() {
        return this.mName;
    }

}


class NumberExpression extends Expression {

    constructor(number) {
        super();
        this.mNumber = number;
    }

    toString() {
        return this.mNumber.toString();
    }

}


class OperatorExpression extends Expression {
    
    constructor(left, operator, right) {
        super();
        this.mLeft = left;
        this.mOperator = operator;
        this.mRight = right;
    }

    toString() {
        return `(${this.mLeft.toString()} ${TokenType.toStr(this.mOperator)} ${this.mRight.toString()})`
    }

}


class PrefixExpression extends Expression {

    constructor(operator, right) {
        super();
        this.mOperator = operator;
        this.mRight = right;
    }

    toString() {
        return `(${TokenType.toStr(this.mOperator)}${this.mRight})`;
    }

}