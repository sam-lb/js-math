const { tracker } = require("../parsing/errors.js");
const { Complex, complex } = require("../math/complex.js");
const { Matrix, matrix } = require("../math/matrix.js");
const { Euclid } = require("../math/geometry.js");
const { sscale, ssub, icosphere, icosphere_flat } = require("../math/icosphere.js"); // fix this garbage
const { stereographic, inverseStereoProject, perspectiveProject } = require("../math/projection.js");
const { rvec } = require("../math/rvector.js");
const { scope, defaultValueScope, valueScope } = require("./scope.js");
const { evaluate } = require("./evaluator.js");
const { classifyInput, classifySliderInput, validateLines, populateUserScope, validateAST } = require("./expression_processor.js");
const { translateToGLSL } = require("./translator.js");
const { VariableDefinition, FunctionDefinition } = require("./input_expressions.js");


p5.disableFriendlyErrors = true; // ridiculous that this is on by default
window.plot = undefined;
window.lastMouseX = undefined;
window.lastMouseY = undefined;
window.mouseIsDown = false;
window.resizeBarStart = false;
let RENDERER = "WebGL";

const pValueArray = [
    0.99999999999980993,
    676.5203681218851,
    -1259.1392167224028,
    771.32342877765313,
    -176.61502916214059,
    12.507343278686905,
    -0.13857109526572012,
    9.9843695780195716e-6,
    1.5056327351493116e-7
];

const GRADIENTS = {
    "monokai": [
        [0.97647059, 0.99215686, 1.0, 0.65098039, 0.4, 0.68235294],
        [0.14901961, 0.59215686, 0.84705882, 0.88627451, 0.85098039, 0.50588235],
        [0.44705882, 0.12156863, 0.4, 0.18039216, 0.9372549, 1.0],            
    ],
};


/** MathQuill handling */


const MQ = MathQuill.getInterface(2);
const opsString = Object.keys(scope.builtin).filter(x => x.length > 1).join(" ");
const fields = {};
const sliderFields = {};

const menuHTML = (id, error=null) => {
    let imageSrc, displayText;
    if (error === null) {
        imageSrc = "../data/settings_transparent.png";
        displayText = "Settings";
    } else {
        imageSrc = "../data/error_transparent.png";
        displayText = error;
    }
    return `<div>${id}</div>
    <div style="display:flex;">
        <img src="${imageSrc}" style="width:25px;height:25px;" onclick="displayOverlayMenu(${id});" title="${displayText}"></img>
    </div>`;
};

function displayOverlayMenu(id) {
    const overlay = document.querySelector("#overlay-menu-container");
    overlay.style.display = "block";
    const additionalSettings = fields[id]["settingsHTML"] ?? "";
    overlay.innerHTML = `
    Settings for expression ${id}
    <hr>${additionalSettings}
    `;
}

function generateSettingsHTML(id) {
    let checked, colorMode;
    if (fields[id]["settingsHTML"] || document.querySelector(`#display-checkbox-${id}`)) {
        checked = fields[id]["displaySettings"]["display"];
        colorMode = fields[id]["displaySettings"]["colorMode"];
    } else {
        checked = true;
        colorMode = "default";
    }
    const checkedString = checked ? " checked" : "";
    fields[id]["displaySettings"] = {
        "display": checked,
        "colorMode": colorMode,
    }

    return `<label for="display-checkbox-${id}">Display?</label>
    <input type="checkbox" id="display-checkbox-${id}" oninput="plot.toggleDisplay(${id});"${checkedString}><br>
    <label for="display-coloring-dropdown-${id}">Coloring mode</label>
    <select id="display-coloring-dropdown-${id}" onchange="plot.setColorMode(${id});">
        <option value="default">Default (HSV rainbow)</option>
        <option value="default-discrete">Discrete Default</option>
        <option value="gradient">Gradient</option>
        <option value="gradient-discrete">Discrete Gradient</option>
        <option value="image-repeat">Image (repeated)</option>
        <option value="image-stretch">Image (stretch)</option>
    </select>
    `.replace(`value="${colorMode}">`, `value="${colorMode}" selected>`); // ah yes
}

function handleDisplayToggles(lines) {
    if (!lines) return;
    const plottableIDs = [];
    for (const line of lines) {
        if (!(line instanceof FunctionDefinition)) {
            fields[line.id]["settingsHTML"] = "";
            continue;
        }
        const locals = Object.keys(scope.userGlobal[line.name].locals);
        if (locals.length !== 1 || locals[0] !== "z") {
            fields[line.id]["settingsHTML"] = "";
            continue;
        }

        plottableIDs.push(line.id);
    }

    if (plottableIDs.length === 0) return;
    for (id of plottableIDs) {
        fields[id]["settingsHTML"] = generateSettingsHTML(id);        
    }
}

function handleSlider(id) {
    const slider = document.querySelector(`#slider-${id}`);
    const variable = fields[id].field;
    const assignment = variable.latex().split("=")[0];
    variable.latex(`${assignment}=${parseFloat(slider.value)}`);
}

function bottomHTML(target, bounds, id) {
    const div = document.querySelector(`#${target}`);
    const oldContainer = document.querySelector(`#slider-container-${id}`);
    if (bounds === null) {
        if (sliderFields[id]) delete sliderFields[id];
        if (oldContainer) div.removeChild(oldContainer);
        return;
    }
    if (oldContainer) {
        const slider = document.querySelector(`#slider-${id}`);
        // slider.setAttribute("min", sliderFields[id].min.latex());
        // slider.setAttribute("max", sliderFields[id].max.latex());
        const calculatedBounds = (sliderFields[id]["getBounds"] ?? (() => [0, 1]))();
        slider.setAttribute("min", calculatedBounds[0].toString());
        slider.setAttribute("max", calculatedBounds[1].toString());
        slider.value = fields[id].field.latex().split("=")[1];
        return;
    }

    const container = document.createElement("div");
    container.setAttribute("class", "slider-container");
    container.setAttribute("id", `slider-container-${id}`);
    const startSpan = document.createElement("span");
    
    const slider = document.createElement("input");
    slider.setAttribute("type", "range");
    slider.setAttribute("min", `${bounds.min}`);
    slider.setAttribute("max", `${bounds.max}`);
    const step = (bounds.max - bounds.min) / 100;
    slider.setAttribute("step", `${step}`);
    slider.setAttribute("id", `slider-${id}`);
    slider.setAttribute("class", "variable-slider");
    slider.setAttribute("value", fields[id].field.latex().split("=")[1]);
    slider.setAttribute("oninput", `handleSlider(${id});`);

    const endSpan = document.createElement("span");
    startSpan.setAttribute("id", `start-field-${id}`);
    endSpan.setAttribute("id", `end-field-${id}`);

    container.appendChild(startSpan);
    container.appendChild(slider);
    container.appendChild(endSpan);
    div.appendChild(container);

    const startField = MQ.MathField(startSpan, {});
    const endField = MQ.MathField(endSpan, {});

    sliderFields[id] = {
        "min": startField,
        "max": endField,
    };

    startField.latex(`${bounds.min}`);
    endField.latex(`${bounds.max}`);
}

document.addEventListener("mousedown", (event) => {
    const overlay = document.querySelector("#overlay-menu-container");
    if (!overlay.contains(event.target)) {
        overlay.style.display = "none";
    }
});

function addField(parent=null) {
    /** add new math input field. parent: parent element */

    const newDiv = document.createElement("div");
    newDiv.setAttribute("class", "math-input-div-container");

    const subDiv = document.createElement("div");
    subDiv.setAttribute("class", "math-input-div");

    const newSpan = document.createElement("span");
    newSpan.setAttribute("class", "math-input");

    const newField = MQ.MathField(newSpan, {});
    newDiv.setAttribute("id", `math-input-div-container-${newField.id}`);

    const newMenu = document.createElement("div");
    newMenu.setAttribute("class", "math-input-side-menu");
    newMenu.setAttribute("id", `math-input-side-menu-${newField.id}`);
    newMenu.innerHTML = menuHTML(newField.id);

    const bottomDiv = document.createElement("div");
    bottomDiv.setAttribute("id", `math-input-bottom-div-${newField.id}`);
    subDiv.appendChild(newMenu);
    subDiv.appendChild(newSpan);
    newDiv.appendChild(subDiv);
    newDiv.appendChild(bottomDiv);

    if (parent === null) {
        const container = document.querySelector("#math-input-container");
        container.appendChild(newDiv);

        fields[newField.id] = {
            id: newField.id,
            field: newField,
            last: null,
            next: null,
            container: newDiv,
            displaySettings: {},
        };
    } else {
        const lastDiv = document.querySelector(`#math-input-div-container-${parent.id}`);
        lastDiv.after(newDiv);

        fields[newField.id] = {
            id: newField.id,
            field: newField,
            last: parent.field,
            next: parent.next,
            container: newDiv,
            displaySettings: {},
        };
        fields[parent.field.id].next = newField;

        advance(parent.field.id, 1);
    }

    return newField.id;
}

function deleteField(id, preserve=true) {
    if (preserve && Object.keys(fields).length === 1) return; // at least one field has to remain
    const entry = fields[id];
    if (entry.next !== null) {
        if (entry.last !== null) {
            fields[entry.next.id]["last"] = entry.last;
            fields[entry.last.id]["next"] = entry.next;
        } else {
        fields[entry.next.id]["last"] = null;
        }
    } else {
        if (entry.last !== null) {
            fields[entry.last.id]["next"] = null;
        } else {
            // there are no fields left
        }
    }
    if (preserve) advance(id, (entry.last === null) ? 1 : -1);

    entry.container.parentNode.removeChild(entry.container);
    delete fields[id];
}

function advance(id, direction) {
    const entry = fields[id];
    if (direction === -1 && entry.last !== null) {
        entry.last.focus();
        entry.last.moveToRightEnd();
    } else if (direction === 1) {
        if (entry.next !== null) {
            entry.next.focus();
            entry.next.moveToRightEnd();
        } else {
            addField(entry);
        }
    }
}


function debounceWrapper(func, interval, initialTimer) {
    let timer = initialTimer;
    return function() {
        const context = this;
        const args = arguments;
        clearTimeout(timer);
        timer = setTimeout(() => {func.apply(context, args);}, interval);
    };
}

window.getCallbacks = (id) => {
    const sideMenu = document.querySelector(`#math-input-side-menu-${id}`);

    const callback = (message, target) => {
        sideMenu.innerHTML = menuHTML(id, message);
    };

    const successCallback = (message, target) => {
        sideMenu.innerHTML = menuHTML(id);        
    };

    return {
        callback: callback,
        successCallback: successCallback,
    };
}

function validateInput() {
    populateUserScope(fields);
    if (tracker.hasError) return null;

    const lines = classifyInput(fields);
    if (tracker.hasError) return null;

    validateLines(lines);
    if (tracker.hasError) return null;

    for (const line of Array.prototype.concat(lines["functions"], lines["variables"], lines["evaluatables"])) {
        const callbacks = getCallbacks(line.id);
        tracker.setCallback(callbacks.callback);
        tracker.setSuccessCallback(callbacks.successCallback);
        line.buildAST();
        if (tracker.hasError) return null;
        validateAST(line.ast);
        if (tracker.hasError) return null;
    }

    const varsAndFuncs = lines["functions"].concat(lines["variables"]);
    const noNumbers = (string) => !(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"].some((x) => string.includes(x)));
    let newOpsString = opsString + " " + varsAndFuncs.filter(line => line.name.length > 1 && noNumbers(line.name)).map(line => line.name).join(" ");
    if (newOpsString[newOpsString.length-1] === " ") newOpsString = newOpsString.slice(0, -1);
    MQ.config({
        autoOperatorNames: newOpsString,
    });

    return varsAndFuncs;
}

function validateSliderInput() {
    const sliderLines = classifySliderInput(sliderFields);
    if (tracker.hasError) return null;

    for (const line of sliderLines) {
        const minLine = line[0];
        const maxLine = line[1];

        const callbacks = getCallbacks(minLine.id);
        tracker.setCallback(callbacks.callback);
        tracker.setSuccessCallback(callbacks.successCallback);

        minLine.buildAST();
        if (tracker.hasError) return null;
        validateAST(minLine.ast);
        if (tracker.hasError) return null;

        maxLine.buildAST();
        if (tracker.hasError) return null;
        validateAST(maxLine.ast);
        if (tracker.hasError) return null;
    }

    return sliderLines;
}

function setBoundCalculators(sliderLines) {
    if (sliderLines === null) return;
    for (const line of sliderLines) {
        const minLine = line[0], maxLine = line[1];
        const minEval = evaluate(minLine.ast), maxEval = evaluate(maxLine.ast);
        sliderFields[minLine.id]["getBounds"] = () => {
            const minBound = minEval.call();
            const maxBound = maxEval.call();
            return (minBound && maxBound) ? [minEval.call().re, maxEval.call().re] : [0, 1];
        };
    }
}

function populateValueScope(lines) {
    Object.keys(valueScope).forEach(key => delete valueScope[key]);
    Object.keys(defaultValueScope).forEach(key => valueScope[key] = defaultValueScope[key]);
    if (lines === null) return;
    for (const line of lines) {
        if (scope.userGlobal[line.name].isFunction) {
            const locals = scope.userGlobal[line.name].locals;
            valueScope[line.name] = evaluate(line.ast, Object.keys(locals).sort(key => locals[key].index));
        } else {
            valueScope[line.name] = evaluate(line.ast);
        }
    }
}

function configureRenderers(lines) {
    if (RENDERER === "WebGL") {
        if (lines === null) {
            plot.setShaderReplacement(null);
            plot.setDisplayReplacement(null);
        } else {
            const emittedGLSL = translateToGLSL(lines.slice());
            if (emittedGLSL) {
                plot.setShaderReplacement(emittedGLSL);
                const displayName = pickDisplay(lines);
                if (displayName) {
                    plot.setDisplayReplacement(displayName.name, colorGLSLFromSettings(displayName.id));
                } else {
                    plot.setDisplayReplacement(null);
                }
            } else {
                plot.setShaderReplacement(null);
                plot.setDisplayReplacement(null);
            }
        }
    } else {
        // use evaluate() and scope.userGlobal to populate valueScope
        plot.clear();
        if (!lines) return;
        const displayName = pickDisplay(lines).name;
        if (!displayName) return;
        plot.addPlottable(new DomainColoring((z) => valueScope[displayName].call({z:z}),));
    }
}

function addSliders(lines) {
    if (lines === null) return;
    for (const line of lines) {
        if (line instanceof VariableDefinition) {
            const bounds = line.sliderBounds(fields);
            bottomHTML(`math-input-bottom-div-${line.id}`, bounds, line.id);
        } else {
            bottomHTML(`math-input-bottom-div-${line.id}`, null, line.id);
        }
    }
}

function pickDisplay(lines) {
    const rev = Object.keys(fields).sort((a, b) => parseInt(b) - parseInt(a));
    for (const id of rev) {
        if (fields[id]["displaySettings"]["display"]) {
            return {id: id, name: lines.filter(l => l.id === id)[0]?.name };
            // return lines.filter(l => l.id === id)[0]?.name;
        }
    }
}

const colorFunctionMap = {
    "default": "getColorDefault",
    "default-discrete": "getColorDiscreteDefault",
    "gradient": "getColorGradient",
    "gradient-discrete": "getColorDiscreteGradient",
    "image-repeat": "getColorTextureRepeat",
    "image-stretch": "getColorTextureStretch",
};

function colorGLSLFromSettings(id) {
    return `vec3 col;
    if (isInvalid(outp)) {
        col = vec3(0., 0., 0.);
    } else {
        col = ${colorFunctionMap[fields[id]["displaySettings"]["colorMode"]]}(outp);
    }`;
}

function fieldEditHandler(mathField) {
    if (mathField === null || fields[mathField.id]) {
        const lines = validateInput();
        const sliderLines = validateSliderInput();
        populateValueScope(lines);
        setBoundCalculators(sliderLines);
        addSliders(lines);
        handleDisplayToggles(lines);
        configureRenderers(lines);
    } else {
        // slider field
        fieldEditHandler(null);
    }
}

const firstField = addField();
fields[firstField].field.focus();

MQ.config({
    autoCommands: "pi sqrt tau alpha beta Gamma",
    supSubsRequireOperand: true,
    charsThatBreakOutOfSupSub: "",
    autoOperatorNames: opsString,
    handlers: {
        moveOutOf: (direction, mathField) => {
            if (!(direction === MQ.L || direction === MQ.R)) mathField.moveToLeftEnd();
        },
        enter: (mathField) => {
            mathField.moveToLeftEnd();
            advance(mathField.id, 1);
        },
        downOutOf: (mathField) => { 
            mathField.moveToLeftEnd();
            advance(mathField.id, 1);
        },
        upOutOf: (mathField) => {
            mathField.moveToLeftEnd();
            advance(mathField.id, -1);
        },
        deleteOutOf: (direction, mathField) => { if (direction === MQ.L) deleteField(mathField.id); },
        edit: (mathField) => {
            if (fields[mathField.id]) {
                debounceWrapper(fieldEditHandler, 500, -1)(mathField);
            } else {
                fieldEditHandler(mathField);
            }
        }
    },
});


/** ******************************** */



function linspace(min, max, n) {
	/* Returns n equally spaced values between min and max (including endpoints) */
	const result = [];
	const range = max - min;
	for (let i=0; i<n; i++) {
		result.push(min + range * i / (n-1));
	}
	return result;
}


class Plot {

    static modes = {
        PLANE: 1,
        SPHERE: 2,
        CUBE: 3,
    };

    constructor(
        displayWidth, displayHeight, bounds=null, mode=null, displayWindowInfo, reglInstance=null,
        shaders=null
    ) {
        this.gridlineSpacing = 1;
        this.boundsChangedSinceLastDraw = false;
        this.displayWindowInfo = displayWindowInfo;
        this.configureWindow(displayWidth, displayHeight, bounds);
        this.plottables = [];
        this.polygons = [];

        this.reglInstance = reglInstance;
        this.shaders = shaders;
        this.shaderReplacement = null;
        this.setDisplayReplacement(null);

        this.needsUpdate = true;

        this.mode = (mode === null) ? Plot.modes.PLANE : mode;
        this.camera = {
            alpha: 1,
            beta: 0,
            pitch: .786,
            roll: 0,
            yaw: .672,
        };
        this.calculateRotationMatrix();

        this.planeMesh = this.generatePlaneMesh(100);
        this.sphereMesh = icosphere_flat(5);
    }

    configureWindow(newWidth, newHeight, bounds=null) {
        if (bounds === null) {
            if (!this.windowConfigured) {
                // set to default of 8 real units, centered, and square unit aspect ratio
                this.units = complex(8, 8 * newHeight / newWidth);
                this.offset = complex(0, 0); // centered
            } else {
                // retain ratio
                // oldX / oldWidth = newX / newWidth --> newX = newWidth * (oldX / oldWidth)
                // newY = newHeight * (oldY / oldHeight)
                this.units = complex(
                    newWidth * (this.units.re / this.dimensions.re),
                    newHeight * (this.units.im / this.dimensions.im)
                );
            }
            this.bounds = {
                xMin: this.offset.re - 0.5 * this.units.re,
                xMax: this.offset.re + 0.5 * this.units.re,
                yMin: this.offset.im - 0.5 * this.units.im,
                yMax: this.offset.im + 0.5 * this.units.im,
            };
        } else {
            // set bounds directly
            this.bounds = bounds;
            this.units = complex(this.bounds.xMax - this.bounds.xMin, this.bounds.yMax - this.bounds.yMin);
            this.offset = complex(
                (this.bounds.xMin + this.bounds.xMax) / 2,
                (this.bounds.yMin + this.bounds.yMax) / 2,
            );
        }
        this.dimensions = complex(newWidth, newHeight);
        this.aspect = newHeight / newWidth;
        this.halfDimensions = this.dimensions.scale(0.5);
        this.pixelsPerUnit = complex(
            this.dimensions.re / this.units.re,
            this.dimensions.im / this.units.im
        );
        this.gridlineCount = complex(
            this.units.re / this.gridlineSpacing,
            this.units.im / this.gridlineSpacing
        );

        this.boundsChangedSinceLastDraw = true;
        this.needsUpdate = true;
        this.windowConfigured = true;
    }

    setCamera(camera) {
        this.camera.alpha = (camera.alpha === undefined) ? this.camera.alpha : camera.alpha;
        this.camera.beta = (camera.beta === undefined) ? this.camera.beta : camera.beta;
        this.camera.pitch = (camera.pitch === undefined) ? this.camera.pitch : camera.pitch;
        this.camera.yaw = (camera.yaw === undefined) ? this.camera.yaw : camera.yaw;
        this.camera.roll = (camera.roll === undefined) ? this.camera.roll : camera.roll;
        this.needsUpdate = true;
    }

    pan(offset) {
        if (this.mode === Plot.modes.PLANE) {
            this.configureWindow(this.dimensions.re, this.dimensions.im, {
                xMin: this.bounds.xMin + offset.re,
                xMax: this.bounds.xMax + offset.re,
                yMin: this.bounds.yMin + offset.im,
                yMax: this.bounds.yMax + offset.im
            });
        } else {
            this.setCamera({
                pitch: Math.max(Math.min(this.camera.pitch + offset.im, 0.5 * Math.PI), -0.5 * Math.PI),
                yaw: Math.max(Math.min(this.camera.yaw - offset.re, Math.PI), -Math.PI),
            });
        }
    }

    zoom(factor) {
        const newHalfUnits = this.units.scale(factor / 2);
        const center = complex(
            (this.bounds.xMin + this.bounds.xMax) / 2,
            (this.bounds.yMin + this.bounds.yMax) / 2,
        );

        this.configureWindow(this.dimensions.re, this.dimensions.im, {
            xMin: center.re - newHalfUnits.re,
            xMax: center.re + newHalfUnits.re,
            yMin: center.im - newHalfUnits.im,
            yMax: center.im + newHalfUnits.im,
        });
    }

    state() {
        const latex = [];
        for (const id of Object.keys(fields)) {
            if (fields[id]) latex.push(fields[id].field.latex());
        }
        return JSON.stringify({
            camera: this.camera,
            bounds: this.bounds,
            expressions: latex,
            mode: this.mode,
        }, null, 4);
    }

    loadState(state) {
        state = JSON.parse(state);

        this.setCamera(state.camera);
        this.configureWindow(this.dimensions.re, this.dimensions.im, state.bounds);
        tabSwitch(state.mode-1);

        for (const id of Object.keys(fields)) {
            deleteField(id, false);
        }

        let lastField = null;
        for (const expr of state.expressions) {
            const newField = addField(lastField);
            fields[newField].field.latex(expr);
        }
    }

    downloadState() {
        const state = encodeURIComponent(this.state());
        const tempEl = document.createElement("a");
        tempEl.setAttribute("href", `data:text/json;charset=utf-8,${state}`);
        tempEl.setAttribute("download", "plot.json");
        document.body.appendChild(tempEl);
        tempEl.click();
        tempEl.remove();
    }

    uploadState() {
        const tempEl = document.createElement("input");
        tempEl.setAttribute("type", "file");
        tempEl.setAttribute("accept", ".json");
        tempEl.setAttribute("id", "file-selector");
        document.body.appendChild(tempEl);
        tempEl.click();

        tempEl.onchange = () => {
            const selector = document.querySelector("#file-selector");
            const files = selector.files;
            if (files.length <= 0) return;
            const reader = new FileReader();

            reader.onload = (event) => {
                this.loadState(event.target.result);
            }

            reader.readAsText(files.item(0));
            selector.parentNode.removeChild(selector);
        }
    }

    unitsToPixels(z) {
        return complex(
            (z.re - this.offset.re) * this.pixelsPerUnit.re + this.halfDimensions.re,
            -(z.im - this.offset.im) * this.pixelsPerUnit.im + this.halfDimensions.im
        );
    }

    applyCamera(z) {
        if (this.mode === Plot.modes.SPHERE) {
            if (z instanceof Complex) {
                z = inverseStereoProject(z);
            } else {
                z = matrix(z).transpose();
            }
            return Matrix.multiply(this.rotationMatrix, z);
        } else if (this.mode === Plot.modes.CUBE) {
            if (z instanceof Complex) {
                z = matrix([
                    z.re, z.im, 0,
                ]).transpose();
            } else {
                z = matrix(z).transpose();
            }
            return Matrix.multiply(this.rotationMatrix, z);
        } else {
            return z;
        }
    }

    coordinateTransform(z) {
        if (this.mode !== Plot.modes.PLANE) z = perspectiveProject(z, this.camera.alpha, this.camera.beta);
        return this.unitsToPixels(z);
    }

    spaceToScreen(z) {
        return this.coordinateTransform(this.applyCamera(z));
    }

    pixelsToUnits(z) {
        // note: this is NOT an exact inverse of unitsToPixels!!!
        return complex(
            z.re / this.pixelsPerUnit.re,
            -z.im / this.pixelsPerUnit.im
        );
    }

    setMode(mode) {
        const previousMode = this.mode;
        this.mode = mode;

        if (mode === Plot.modes.PLANE) {
            if (this.savedBounds !== undefined) this.configureWindow(this.dimensions.re, this.dimensions.im, this.savedBounds);
        } else {
            if (previousMode === Plot.modes.PLANE) this.savedBounds = this.bounds;
            this.configureWindow(this.dimensions.re, this.dimensions.im, {
                xMin: -2.5,
                xMax: 2.5,
                yMin: -2.5 * this.aspect,
                yMax: 2.5 * this.aspect,
            });
        }

        this.boundsChangedSinceLastDraw = true;
        this.needsUpdate = true;
    }

    calculateRotationMatrix() {
        this.rotationMatrix = Matrix.rotationMatrix3D(this.camera.pitch, this.camera.roll, this.camera.yaw);
    }

    clear() {
        this.plottables = [];
        this.needsUpdate = true;
    }

    addPlottable(plottable) {
        this.plottables.push(plottable);
        this.needsUpdate = true;
    }

    drawAxes() {
        if (this.mode === Plot.modes.PLANE) {
            const xAxisStart = this.spaceToScreen(complex(this.bounds.xMin, 0));
            const xAxisStop = this.spaceToScreen(complex(this.bounds.xMax, 0));
            const yAxisStart = this.spaceToScreen(complex(0, this.bounds.yMin));
            const yAxisStop = this.spaceToScreen(complex(0, this.bounds.yMax));

            push();
            
            stroke(0);
            strokeWeight(1);
            line(xAxisStart.re, xAxisStart.im, xAxisStop.re, xAxisStop.im);
            line(yAxisStart.re, yAxisStart.im, yAxisStop.re, yAxisStop.im);

            pop();
        } else {
            return;
            const xAxisStart = this.spaceToScreen([-2, 0, 0]);
            const xAxisStop = this.spaceToScreen([2, 0, 0]);
            const yAxisStart = this.spaceToScreen([0, -2, 0]);
            const yAxisStop = this.spaceToScreen([0, 2, 0]);
            const zAxisStart = this.spaceToScreen([0, 0, -2]);
            const zAxisStop = this.spaceToScreen([0, 0, 2]);
            
            push();
            
            stroke(0);
            strokeWeight(1);
            line(xAxisStart.re, xAxisStart.im, xAxisStop.re, xAxisStop.im);
            line(yAxisStart.re, yAxisStart.im, yAxisStop.re, yAxisStop.im);
            line(zAxisStart.re, zAxisStart.im, zAxisStop.re, zAxisStop.im);

            pop();
        }
    }

    drawGridlines() {
        const minBound = (x) => floor(x/this.gridlineSpacing) * this.gridlineSpacing;
        const minBoundX = minBound(this.bounds.xMin);
        const minBoundY = minBound(this.bounds.yMin);

        push();

        stroke(200);
        strokeWeight(1);
        for (let i=0; i<this.gridlineCount.im+1; i++) {
            // horizontal gridlines
            const y = minBoundY + i * this.gridlineSpacing;
            const start = this.unitsToPixels(complex(this.bounds.xMin, y));
            const end = this.unitsToPixels(complex(this.bounds.xMax, y));
            line(start.re, start.im, end.re, end.im);
        }
        for (let i=0; i<this.gridlineCount.re+1; i++) {
            // vertical gridlines
            const x = minBoundX + i * this.gridlineSpacing;
            const start = this.unitsToPixels(complex(x, this.bounds.yMin));
            const end = this.unitsToPixels(complex(x, this.bounds.yMax));
            line(start.re, start.im, end.re, end.im);
        }

        pop();
    }

    draw() {
        background(255);
        this.drawGridlines();
        this.drawAxes();

        this.polygons = [];

        for (let plottable of this.plottables) {
            plottable.update();
            this.polygons = this.polygons.concat(plottable.getPolygons());
        }

        if (this.mode !== Plot.modes.PLANE) {
            this.polygons.sort((poly1, poly2) => {
                return this.applyCamera(poly2.centroid).get(1, 0) - this.applyCamera(poly1.centroid).get(1, 0);
            });
        }

        push();
        for (let poly of this.polygons) {
            if (poly.vertices.length === 1) {
                // point
                fill(0);
                noStroke();
                const point = this.coordinateTransform(this.applyCamera(poly.vertices[0]));
                circle(point.re, point.im, 1);
            } else if (poly.vertices.length === 2) {
                // line
                stroke(0);
                const point1 = this.coordinateTransform(this.applyCamera(poly.vertices[0]));
                const point2 = this.coordinateTransform(this.applyCamera(poly.vertices[1]));
                line(point1.re, point1.im, point2.re, point2.im);
            } else {
                // polygon
                if (poly.outline) {
                    stroke(0);
                } else {
                    noStroke();
                }
                fill(poly.fillColor);

                beginShape();
                for (let vert of poly.vertices) {
                    const point = this.coordinateTransform(this.applyCamera(vert));
                    vertex(point.re, point.im);
                }
                endShape(CLOSE);
            }
        }
        pop();

        this.boundsChangedSinceLastDraw = false;
    }

    generatePlaneMesh(count) {
        let x = -1, y = -1;
        const step = 2 / count;
        const verts = [];
        const sqrt2 = Math.sqrt(2);
        for (let i=0; i<count; i++) {
            for (let j=0; j<count; j++) {
                const nextX = x + step;
                const nextY = y + step;

                verts.push([x / sqrt2, y / sqrt2, 0]);
                verts.push([nextX / sqrt2, y / sqrt2, 0]);
                verts.push([x / sqrt2, nextY / sqrt2, 0]);

                verts.push([nextX / sqrt2, y / sqrt2, 0]);
                verts.push([nextX / sqrt2, nextY / sqrt2, 0]);
                verts.push([x / sqrt2, nextY / sqrt2, 0]);

                x += step;
            }
            x = -1;
            y += step;
        }
        return verts;
    }

    setShaderReplacement(glslSource) {
        this.shaderReplacement = glslSource;
        this.needsUpdate = true;
    }

    setDisplayReplacement(name, colorGLSL) {
        if (name) {
            this.displayReplacement = `vec2 outp = udf_${name}(z);\n${colorGLSL}`;
            this.displayReplacementFunction = `vec2 outp = udf_${name}(z);`
        } else {
            this.displayReplacement = "vec2 outp = vec2(1., 0.);vec3 col=vec3(0.9, 0.9, 0.9);";
            this.displayReplacementFunction = "vec2 outp = vec2(1., 0.);";
        }
        this.needsUpdate = true;
    }

    toggleDisplay(id) {
        const checkbox = document.querySelector(`#display-checkbox-${id}`);
        fields[id]["displaySettings"]["display"] = checkbox.checked;
        fieldEditHandler(null);
    }

    setColorMode(id) {
        const select = document.querySelector(`#display-coloring-dropdown-${id}`);
        fields[id]["displaySettings"]["colorMode"] = select.value;
        fieldEditHandler(null);
    }

    drawFnPlane() {
        let frag = this.shaders["complexmos.frag"];
        if (this.shaderReplacement !== null) {
            frag = frag.replace(/\/\/REPLACE_BEGIN.*\/\/REPLACE_END/ms, this.shaderReplacement);
        }
        frag = frag.replace(/\/\/DISPLAY_REPLACE_BEGIN.*\/\/DISPLAY_REPLACE_END/ms, this.displayReplacement);

        return this.reglInstance({
            frag: frag,
            vert: this.shaders["complexmos.vert"],

            attributes: {
                position: [
                    [-1, -1], [1, 1], [-1, 1],
                    [-1, -1], [1, 1], [1, -1],
                ],
            },

            uniforms: {
                width: this.reglInstance.context("viewportWidth"),
                height: this.reglInstance.context("viewportHeight"),

                xBounds: [this.bounds.xMin, this.bounds.xMax],
                yBounds: [this.bounds.yMin, this.bounds.yMax],

                pValues: pValueArray,

                gradR: GRADIENTS["monokai"][0],
                gradG: GRADIENTS["monokai"][1],
                gradB: GRADIENTS["monokai"][2],

                texture: this.reglInstance.texture(this.shaders["sample texture"]),
            },

            count: 6
        });
    }

    drawFnSphere() {
        const mesh = this.sphereMesh;
        const vertexCount = mesh.length;

        let frag = this.shaders["complexmos_sphere.frag"];
        if (this.shaderReplacement !== null) {
            frag = frag.replace(/\/\/REPLACE_BEGIN.*\/\/REPLACE_END/ms, this.shaderReplacement);
        }
        frag = frag.replace(/\/\/DISPLAY_REPLACE_BEGIN.*\/\/DISPLAY_REPLACE_END/ms, this.displayReplacement);

        return this.reglInstance({
            frag: frag,
            vert: this.shaders["complexmos_sphere.vert"],

            attributes: {
                position: mesh,
            },

            uniforms: {
                width: this.reglInstance.context("viewportWidth"),
                height: this.reglInstance.context("viewportHeight"),

                xBounds: [this.bounds.xMin, this.bounds.xMax],
                yBounds: [this.bounds.yMin, this.bounds.yMax],

                pValues: pValueArray,
                alpha: this.camera.alpha,
                beta: this.camera.beta,

                row1: this.rotationMatrix.getRow(0),
                row2: this.rotationMatrix.getRow(1),
                row3: this.rotationMatrix.getRow(2),

                gradR: GRADIENTS["monokai"][0],
                gradG: GRADIENTS["monokai"][1],
                gradB: GRADIENTS["monokai"][2],

                texture: this.reglInstance.texture(this.shaders["sample texture"]),
            },

            count: vertexCount,

            cull: {
                enable: true,
                face: "back",
            },

            frontFace: "cw",
        });
    }

    drawFn3D() {
        const mesh = this.planeMesh;
        const vertexCount = mesh.length;

        let frag = this.shaders["complexmos_cube.frag"];
        let vert = this.shaders["complexmos_cube.vert"];
        if (this.shaderReplacement !== null) {
            frag = frag.replace(/\/\/REPLACE_BEGIN.*\/\/REPLACE_END/ms, this.shaderReplacement);
            vert = vert.replace(/\/\/REPLACE_BEGIN.*\/\/REPLACE_END/ms, this.shaderReplacement);
            vert = vert.replace(/\/\/DISPLAY_REPLACE_BEGIN.*\/\/DISPLAY_REPLACE_END/ms, this.displayReplacementFunction);
        }
        frag = frag.replace(/\/\/DISPLAY_REPLACE_BEGIN.*\/\/DISPLAY_REPLACE_END/ms, this.displayReplacement);

        return this.reglInstance({
            frag: frag,
            vert: vert,

            attributes: {
                position: mesh,
            },

            uniforms: {
                width: this.reglInstance.context("viewportWidth"),
                height: this.reglInstance.context("viewportHeight"),

                xBounds: [this.bounds.xMin, this.bounds.xMax],
                yBounds: [this.bounds.yMin, this.bounds.yMax],

                pValues: pValueArray,
                alpha: this.camera.alpha,
                beta: this.camera.beta,

                row1: this.rotationMatrix.getRow(0),
                row2: this.rotationMatrix.getRow(1),
                row3: this.rotationMatrix.getRow(2),

                gradR: GRADIENTS["monokai"][0],
                gradG: GRADIENTS["monokai"][1],
                gradB: GRADIENTS["monokai"][2],

                texture: this.reglInstance.texture(this.shaders["sample texture"]),
            },

            cull: {
                enable: false,
            },

            frontFace: "ccw",

            count: vertexCount,
        });
    }

    update() {
        if (this.needsUpdate) {
            if (this.mode !== Plot.modes.PLANE) this.calculateRotationMatrix();
            if (RENDERER === "p5") {
                this.draw();
            } else {
                let drawFn;
                if (this.mode === Plot.modes.PLANE) {
                    drawFn = this.drawFnPlane();
                } else if (this.mode === Plot.modes.SPHERE) {
                    drawFn = this.drawFnSphere();
                } else {
                    drawFn = this.drawFn3D();
                }
                drawFn();
            }
            this.needsUpdate = false;
        }
    }

}


class Plottable {

    static id = 0;

    constructor() {
        this.id = Plottable.id;
        Plottable.id++;
    }

    getPolygons() {

    }

    update() {

    }

}


class Point extends Plottable {

    constructor(position) {
        super();
        this.position = position;
        this.radius = 1;
    }

    getPolygons() {
        return [new Polygon([this.position])];
    }

}


class Circle extends Plottable {

    constructor(center, radius) {
        super();
        this.center = center;
        this.radius = radius;
        this.generatePoints();
    }

    generatePoints() {
        this.points = [];
        const pointCount = 100;
        for (let i=0; i<pointCount; i++) {
            const angle = 2 * Math.PI * i / pointCount;
            this.points.push(
                complex(
                    Math.cos(angle), Math.sin(angle)
                ).scale(this.radius).add(this.center)
            );            
        }
    }

    getPolygons() {
        const polygons = [];
        for (let i=1; i<this.points.length; i++) {
            polygons.push(new Polygon(
                [this.points[i-1], this.points[i]]
            ));
        }
        return polygons;
    }

}


class Parametric extends Plottable {

    constructor(fn, range=null, pointCount=null) {
        /**
         * fn: parameterization U->C of curve in C, U subs R
         * U = [range.start, range.stop]
         */
        super();
        this.fn = fn;
        this.pointCount = (pointCount === null) ? 100 : pointCount;
        this.setRange(range);
    }

    setRange(range) {
        this.range = (range === null) ? {start: 0, stop: 1} : range;
        this.generatePoints();
    }

    generatePoints() {
        this.points = [];
        for (let t of linspace(this.range.start, this.range.stop, this.pointCount)) {
            this.points.push(
                this.fn(t)
            );
        }
    }

    getPolygons() {
        const polygons = [];
        for (let i=1; i<this.points.length; i++) {
            polygons.push(new Polygon(
                [this.points[i-1], this.points[i]]
            ));
        }
        return polygons;
    }

}


class Polygon {

    constructor(vertices, fillColor, outline=false) {
        this.vertices = vertices;
        this.fillColor = fillColor;
        this.outline = outline;

        if (vertices[0] instanceof Complex) {
            this.centroid = Euclid.centroid(vertices);
        } else {
            let totalX = 0, totalY = 0, totalZ = 0;
            for (let vert of vertices) {
                totalX += vert[0];
                totalY += vert[1];
                totalZ += vert[2];
            }
            this.centroid = [
                totalX / this.vertices.length,
                totalY / this.vertices.length,
                totalZ / this.vertices.length,
            ];
        }
    }

}


class NormPlot extends Plottable {

    constructor(fn, bounds=null, density=100) {
        super();
        this.fn = fn;
        if (bounds === null) {
            this.bounds = plot.bounds
            this.fixedBounds = false;
        } else {
            this.bounds = bounds;
            this.fixedBounds = true;
        }
        this.samples = complex(density, density);
        this.generatePolygons();
    }

    generatePolygons() {
        this.polygons = [];

        if (plot.mode !== Plot.modes.CUBE) {
            return;
        }

        let x = this.bounds.xMin, y = this.bounds.yMin;
        const step = complex(
            (this.bounds.xMax - this.bounds.xMin) / (this.samples.re - 1),
            (this.bounds.yMax - this.bounds.yMin) / (this.samples.im - 1),
        );

        push(); // for colormode
        colorMode(RGB);
        for (let i=0; i<this.samples.re-1; i++) {
            for (let j=0; j<this.samples.im-1; j++) {
                const square = [
                    complex(x, y),
                    complex(x + step.re + 0.01, y),
                    complex(x + step.re + 0.01, y + step.im + 0.01),
                    complex(x, y + step.im + 0.01),
                ].map(z => [
                    z.re, z.im, this.fn(z).norm(),
                ]);
                const centroid = complex(x + step.re / 2, y + step.im / 2);
                const output = this.fn(centroid);
                const color1 = color(100, 0, 255*Math.tanh(  ((2 * Math.PI + output.arg()) % (2*Math.PI)) / (2 * Math.PI)  ));

                this.polygons.push(new Polygon(square, color1));

                x += step.re;
            }
            x = this.bounds.xMin;
            y += step.im;
        }
        pop();
    }

    getPolygons() {
        return this.polygons;
    }

    update() {
        if (plot.boundsChangedSinceLastDraw && !this.fixedBounds) {
            // TODO: This can be optimized to only recalculate the new polygons
            // by checking the difference between this.bounds and plot.bounds
            this.bounds = plot.bounds;
            this.generatePolygons();
        }
    }

}


class DomainColoring extends Plottable {

    constructor(fn, bounds=null, density=100) {
        super();
        this.fn = fn;
        if (bounds === null) {
            this.bounds = plot.bounds
            this.fixedBounds = false;
        } else {
            this.bounds = bounds;
            this.fixedBounds = true;
        }
        this.samples = complex(density, density);
        this.subdivisions = Math.floor(Math.log(density * density) / Math.log(4));
        this.generatePolygons();
    }

    generatePolygons() {
        if (plot.mode === Plot.modes.PLANE) {
            this.generatePolygonsPlane();
        } else if (plot.mode === Plot.modes.SPHERE) {
            this.generatePolygonsSphere();
        } else {
            this.generatePolygonsPlane();
        }
    }

    generatePolygonsSphere() {
        this.polygons = icosphere(4);
        const threshold = 1000;
        const angleTransform = (angle) => {
            return 360 * ((angle + 2 * Math.PI) % (2 * Math.PI)) / (2 * Math.PI); // modulo is not true remainder in JS
        };
        const normTransform = (norm) => {
            return 25 + 75 * (
                (2 / Math.PI) * Math.atan(norm)
            );
        };
        const parabolaStep = (x) => {
            return x * x * x * (10 - 15 * x + 6 * x * x);
        };
        const highlightPoles = (norm) => {
            return 100 - 85 * Math.max(0, Math.min(1, 0.5 * (Math.sign(norm - threshold) + 1) * parabolaStep(norm - threshold)));
        };

        const filterNaN = (z) => {
            return complex(
                (z.re < z.re + 1) ? z.re : 0,
                (z.im < z.im + 1) ? z.im : 0,
            );
        };

        const getColor = (z) => {
            const zNormal = filterNaN(complex(z.re - Math.floor(z.re), 1 - (z.im - Math.floor(z.im))).eMult(complex(cImage.width-1, cImage.height-1)));
            return cImage.get(zNormal.re, zNormal.im);
        };

        push();
        colorMode(HSB);
        for (let i=0; i<this.polygons.length; i++) {
            this.polygons[i] = new Polygon(this.polygons[i]);
            const centroid = this.polygons[i].centroid;

            // scale slightly from center
            this.polygons[i].vertices = [
                ssub(1, sscale(1.1, ssub(-1, this.polygons[i].vertices[0], centroid)), centroid),
                ssub(1, sscale(1.1, ssub(-1, this.polygons[i].vertices[1], centroid)), centroid),
                ssub(1, sscale(1.1, ssub(-1, this.polygons[i].vertices[2], centroid)), centroid),
            ];

            const output = this.fn(stereographic(centroid));
            const norm = output.norm();
            if (output === null || Complex.infinite(output) || Complex.nan(output)) {
                this.polygons[i].fillColor = color(0, 0, 100);
            } else {
                this.polygons[i].fillColor = color(angleTransform(output.arg()), highlightPoles(norm), normTransform(norm));
                // this.polygons[i].fillColor = getColor(output);
            }
        }
        pop();
    }

    generatePolygonsPlane() {
        let x = this.bounds.xMin, y = this.bounds.yMin;
        const step = complex(
            (this.bounds.xMax - this.bounds.xMin) / (this.samples.re - 1),
            (this.bounds.yMax - this.bounds.yMin) / (this.samples.im - 1),
        );
        const angleTransform = (angle) => {
            return 360 * ((angle + 2 * Math.PI) % (2 * Math.PI)) / (2 * Math.PI); // modulo is not true remainder in JS
        };
        const normTransform = (norm) => {
            return 25 + 75 * (
                Math.floor((2 / Math.PI * Math.atan(Math.sqrt(norm))) / 0.2) * 0.2
            );
        };
        const filterNaN = (z) => {
            return complex(
                (z.re < z.re + 1) ? z.re : 0,
                (z.im < z.im + 1) ? z.im : 0,
            );
        };

        const a = 2;
        const distFromAx = (z) => {
            z = rvec(z.re, z.im);
            return Math.tanh(z.proj(rvec(1, a)).mag()) * 2 * Math.PI;
        };
        const angleize = (z) => {
            return Math.tanh(z.norm()) * 2 * Math.PI;
        }

        const getColor = (z) => {
            const zNormal = filterNaN(complex(z.re - Math.floor(z.re), 1 - (z.im - Math.floor(z.im))).eMult(complex(cImage.width-1, cImage.height-1)));
            return cImage.get(zNormal.re, zNormal.im);
        };
        this.polygons = [];
        push();
        colorMode(HSB);
        for (let i=0; i<this.samples.re-1; i++) {
            for (let j=0; j<this.samples.im-1; j++) {
                const square = [
                    complex(x, y),
                    complex(x + step.re + 0.01, y),
                    complex(x + step.re + 0.01, y + step.im + 0.01),
                    complex(x, y + step.im + 0.01),
                ];
                const centroid = complex(x + step.re / 2, y + step.im / 2);
                const output = this.fn(centroid);
                let color1;
                if (output === null || Complex.infinite(output) || Complex.nan(output)) {
                    color1 = color(0, 0, 100);                    
                } else {
                    color1 = color(angleTransform(output.arg()), 100, normTransform(output.norm()));
                    // color1 = getColor(output);

                    // const aDist = distFromAx(output);
                    // color1 = color(angleTransform(aDist), 100, 100);
                    // color1 = color(angleTransform(angleize(output)), 100, 100);
                }

                this.polygons.push(new Polygon(square, color1));

                x += step.re;
            }
            x = this.bounds.xMin;
            y += step.im;
        }
        pop();
    }

    getPolygons() {
        return this.polygons;
    }

    update() {
        if (plot.boundsChangedSinceLastDraw && !this.fixedBounds) {
            // TODO: This can be optimized to only recalculate the new polygons
            // by checking the difference between this.bounds and plot.bounds
            this.bounds = plot.bounds;
            this.generatePolygons();
        }
    }

}


class Model extends Plottable {

    constructor(triangles) {
        super();
        this.triangles = [];
        for (let triangle of triangles) {
            this.triangles.push(new Polygon(triangle, color(255, 255, 255), true));
        }
    }

    getPolygons() {
        return this.triangles;
    }

}


let cImage;
function preload() {
    cImage = loadImage("../data/grid_3.png");
}

async function loadImage(src) {
    return new Promise((resolve, reject) => {
        let image = new Image();
        image.src = src;
        image.onerror = reject;
        image.onload = resolve(image);
    });
}

async function loadShaders() {
    const frag = (await fetch("../shaders/complexmos.frag"));
    const vert = (await fetch("../shaders/complexmos.vert"));
    const fragSphere = (await fetch("../shaders/complexmos_sphere.frag"));
    const vertSphere = (await fetch("../shaders/complexmos_sphere.vert"));
    const fragCube = (await fetch("../shaders/complexmos_cube.frag"));
    const vertCube = (await fetch("../shaders/complexmos_cube.vert"));
    const complexLib = (await fetch("../shaders/complex.frag"));
    const coloringLib = (await fetch("../shaders/coloring.frag"));
    const sampleImage = await loadImage("../data/cat.jpg");

    const complexLibSource = await complexLib.text().then(text => text);
    const coloringLibSource = await coloringLib.text().then(text => text);

    const importLib = (match, replacement) => (fileContents) => fileContents.replace(match, replacement);
    const importComplex = importLib(/\/\/IMPORT_COMPLEX/, complexLibSource);
    const importColoring = importLib(/\/\/IMPORT_COLORING/, coloringLibSource);

    const fragShaderSource = await frag.text().then(importComplex).then(importColoring);
    const vertShaderSource = await vert.text().then(text => text);
    const fragCubeShaderSource = await fragCube.text().then(importComplex).then(importColoring);
    const vertCubeShaderSource = await vertCube.text().then(importComplex); // yes the vert shader needs this
    const fragSphereShaderSource = await fragSphere.text().then(importComplex).then(importColoring);
    const vertSphereShaderSource = await vertSphere.text().then(text => text);

    return {
        "complexmos.frag": fragShaderSource,
        "complexmos.vert": vertShaderSource,
        "complexmos_sphere.frag": fragSphereShaderSource,
        "complexmos_sphere.vert": vertSphereShaderSource,
        "complexmos_cube.frag": fragCubeShaderSource,
        "complexmos_cube.vert": vertCubeShaderSource,
        "sample texture": sampleImage,
    };
}

function setupP5(offset=null) {
    const canvasDiv = document.querySelector("#canvas-div");
    canvasDiv.innerHTML = "";
    const canvas = createCanvas(canvasDiv.offsetWidth, canvasDiv.offsetHeight);
    canvas.parent("canvas-div");
    canvasDiv.onwheel = wheelHandler;

    const mode = plot?.mode ?? Plot.modes.PLANE;
    plot = new Plot(canvasDiv.offsetWidth, canvasDiv.offsetHeight, null, mode, false);
    if (offset) plot.pan(offset)
    tabSwitch(plot.mode-1);
    fieldEditHandler(null);
}

function reglLoaded(err, regl, shaders, offset) {
    if (err) {
        console.warn(`Could not load WebGL! Maybe your browser doesn't support it? Using vanilla canvas instead. Specific error: ${err}`);
        RENDERER = "p5";
        setupP5();
        fieldEditHandler(null);
        return;
    }

    console.log("regl loaded!");

    regl.on("lost", contextLost);
    const canvasDiv = document.querySelector("#canvas-div");
    const mode = plot?.mode ?? Plot.modes.PLANE;
    plot = new Plot(canvasDiv.offsetWidth, canvasDiv.offsetHeight, null, mode, false, regl, shaders);
    if (offset) plot.pan(offset)
    tabSwitch(plot.mode-1);    
    fieldEditHandler(null);
}

function shadersLoaded(shaders, offset=null) {
    if (plot?.reglInstance) {
        plot.reglInstance._refresh();
        reglLoaded(null, plot.reglInstance, shaders, offset);
    } else {
        // remove the loading shaders message
        document.querySelector("#canvas-div").innerHTML = "";
        require("regl")({
            container: "#canvas-div",
            onDone: (err, regl) => reglLoaded(err, regl, shaders, offset),
        });
    }
}

function setupWebGL(offset=null) {
    if (plot?.shaders) {
        shadersLoaded(plot.shaders, offset);
    } else {
        loadShaders().then(shaders => shadersLoaded(shaders, offset));
    }
}

function setup(offset=null) {
    if (RENDERER === "p5") {
        setupP5(offset);
    } else {
        setupWebGL(offset); 
    }

    registerMouseEvents();
}

function contextLost() {
    const webGLToggle = document.querySelector("#webgl-toggle");
    webGLToggle.checked = false;
    webGLToggle.disabled = true;
    alert("Your WebGL context has been lost :(");

    setRenderer();
}

function wheelHandler(event) {
    event.preventDefault();
    const factor = 1 + Math.tanh(event.deltaY / 100) / 4;
    plot.zoom(factor);
}

function mouseDragged(event) {
    if (mouseIsDown) {
        const rect = event.target.getBoundingClientRect();
        const mouseX = (event.touches) ? event.touches[0].clientX - rect.left : event.clientX - rect.left;
        const mouseY = (event.touches) ? event.touches[0].clientY - rect.top : event.clientY - rect.top;
        const canvasDiv = document.querySelector("#canvas-div");
        
        if ((0 <= mouseX && mouseX <= canvasDiv.offsetWidth) && (0 <= mouseY && mouseY <= canvasDiv.offsetHeight)) {
            const diff = complex(lastMouseX - mouseX, lastMouseY - mouseY);
            if (plot.mode === Plot.modes.PLANE) {
                plot.pan(plot.pixelsToUnits(diff));
            } else {
                plot.pan(diff.eMult(complex(3 / canvasDiv.clientWidth, -3 / canvasDiv.clientHeight)));
            }
            lastMouseX = mouseX;
            lastMouseY = mouseY;
        }
    }
}

function mousePressed(event) {
    const rect = event.target.getBoundingClientRect();
    const mouseX = (event.touches) ? event.touches[0].clientX - rect.left : event.clientX - rect.left;
    const mouseY = (event.touches) ? event.touches[0].clientY - rect.top : event.clientY - rect.top;
	
    lastMouseX = mouseX;
	lastMouseY = mouseY;
    mouseIsDown = true;
}

function exprBarMousePressed(event) {
    resizeBarStart = true;
}

function mouseReleased(event) {
	lastMouseX = 0;
	lastMouseY = 0;
    mouseIsDown = false;
    resizeBarStart = false;
}

function exprBarResize(event, callback) {
    if (mouseIsDown && resizeBarStart) {
        const target = document.querySelector("#drag-expr-bar");
        const rect = target.getBoundingClientRect();
        const mouseX = (event.touches) ? event.touches[0].clientX - rect.left : event.clientX - rect.left;
        const dx = lastMouseX - mouseX;

        let x = (rect.right - dx) / window.innerWidth;
        x = Math.max(0.20, Math.min(0.75, x));
        const p = 3 * x / (1 - x);

        document.querySelector("#ui-container").style.flex = p.toString();
        callback();
    }
}

function registerMouseEvents() {
    const canvasDiv = document.querySelector("#canvas-div");
    const dragDiv = document.querySelector("#drag-expr-bar");

    canvasDiv.addEventListener("wheel", wheelHandler);
    canvasDiv.addEventListener("mousemove", mouseDragged);
    canvasDiv.addEventListener("touchmove", mouseDragged);
    document.addEventListener("mousedown", mousePressed);
    document.addEventListener("touchstart", mousePressed);
    document.addEventListener("mouseup", mouseReleased);
    document.addEventListener("touchend", mouseReleased);
    dragDiv.addEventListener("mousedown", exprBarMousePressed);
    dragDiv.addEventListener("touchstart", exprBarMousePressed);
    document.addEventListener("mousemove", (event) => exprBarResize(event, resizeDebounced));
    document.addEventListener("touchmove", (event) => exprBarResize(event, resizeDebounced));
}

function windowResized() {
    setTimeout(() => {
        setup(plot.offset);
    }, 100);
}

function tabSwitch(tab) {
    const plane = document.querySelector("#ui-header-plane");
    const sphere = document.querySelector("#ui-header-sphere");
    const cube = document.querySelector("#ui-header-cube");
    if (tab === 0) {
        plane.style.backgroundColor = "white";
        sphere.style.backgroundColor = "lightgray";
        cube.style.backgroundColor = "lightgray";
        plot.setMode(Plot.modes.PLANE);
    } else if (tab === 1) {
        plane.style.backgroundColor = "lightgray";
        sphere.style.backgroundColor = "white";
        cube.style.backgroundColor = "lightgray";
        plot.setMode(Plot.modes.SPHERE);
    } else {
        plane.style.backgroundColor = "lightgray";
        sphere.style.backgroundColor = "lightgray";
        cube.style.backgroundColor = "white";
        plot.setMode(Plot.modes.CUBE);
    }
}

function draw() {
    if (plot) plot.update();
}

function toggleSettingsPopup() {
    const popup = document.querySelector("#settings-popup");
    if (popup.style.display !== "flex") {
        popup.style.display = "flex";
    } else {
        popup.style.display = "none";
    }
}

function setRenderer() {
    const renderer = document.querySelector("#webgl-toggle").checked;
    if (RENDERER === "WebGL" && !renderer) {
        RENDERER = "p5";
        setupP5();
    } else if (RENDERER === "p5" && renderer) {
        RENDERER = "WebGL";
        setupWebGL();
    }
}

// there might be a better way to do this, but it's actually fine
window.resizeDebounced = debounceWrapper(windowResized, 250, -1);
window.preload = preload;
window.displayOverlayMenu = displayOverlayMenu;
window.tabSwitch = tabSwitch;
window.draw = draw;
window.addEventListener("resize", resizeDebounced);
window.toggleSettingsPopup = toggleSettingsPopup;
window.setRenderer = setRenderer;
window.handleSlider = handleSlider;

window.onload = () => {
    const aspect = window.innerWidth / window.innerHeight;
    if (aspect <= 1) {
        alert("Rotate your device for the best experience. Note that features may not work as expected on mobile.");
    } else if (aspect < 4 / 3) {
        alert(`It is recommended to use this app on a device with 4:3 (1.33:1) aspect ratio or greater. Your device aspect ratio: ${Math.floor(100 * aspect) / 100}:1`);
    }
    setup();
};