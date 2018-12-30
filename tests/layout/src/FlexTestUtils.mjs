import Target from "./Target.mjs";
import FlexHtmlComparer from "./flexToHtml/Comparer.mjs";

export default class FlexTestUtils {

    constructor() {
        this.flexHtmlComparer = new FlexHtmlComparer();

        this._createVisibleTestResultsContainer();
    }

    _createVisibleTestResultsContainer() {
        this._visibleTestResultsContainer = document.createElement('div');
        this._visibleTestResultsContainer.style.display = 'block';
        this._visibleTestResultsContainer.style.position = 'relative';
        document.body.appendChild(this._visibleTestResultsContainer);
    }

    layoutFlexAndValidate(structure, options = {}) {
        const root = this._convertToFlex(structure);
        return this.validateLayout(root, options);
    };

    validateLayout(item, options = {}) {
        return this.getLayoutMismatchesBetweenItemAndHtml(item).then(mismatches => {
            if (mismatches.length) {
                // Make failed test info available.
                return this._addVisibleTestResult(item).then(() => {
                    throw new Error("Layout mismatches at items:\n" + mismatches.join("\n"));
                });
            } else if (options.resultVisible) {
                return this._addVisibleTestResult(item);
            }
        });
    };

    _convertToFlex(structure) {
        const root = this.buildFlexFromStructure(structure);
        root.update();
        return root;
    }

    buildFlexFromStructure(structure) {
        const root = new Target();
        root.patch(structure);
        return root;
    }

    _addVisibleTestResult(item) {
        return this._getFlexTestInfoHtml(item).then(div => {
            this._visibleTestResultsContainer.appendChild(div);
        })
    }

    _getFlexTestInfoHtml(item) {
        const container = document.createElement('div');
        container.style.display = 'block';
        return this.flexHtmlComparer.transformItemToHtmlWithMismatchInfo(item).then(div => {
            container.appendChild(div);
            const structure = document.createElement('pre');
            structure.innerText = item.toString();
            container.appendChild(structure);
            return container;
        });
    }

    getLayoutMismatchesBetweenItemAndHtml(item) {
        return this.flexHtmlComparer.getLayoutMismatchesBetweenItemAndHtml(item);
    }


    addMochaTestForAnnotatedStructure(name, structure, showHtml) {
        describe(name, () => {
            it('layouts', done => {
                const root = this._convertToFlex(structure);
                const collector = new AnnotatedStructureMismatchCollector(root);
                const mismatches = collector.getMismatches();
                if (showHtml) {
                    this._addVisibleTestResult(root);
                }
                if (!mismatches.length) {
                    done();
                } else {
                    done(new Error("Mismatches:\n" + mismatches.join("\n") + "\n\n" + root.toString()))
                }
            });
        })
    }

    validateAnnotatedFlex(root) {
        return new Promise((resolve, reject) => {
            const collector = new AnnotatedStructureMismatchCollector(root);
            const mismatches = collector.getMismatches();
            if (mismatches.length) {
                reject(new Error("Mismatches:\n" + mismatches.join("\n") + "\n\n" + root.toString()));
            } else {
                resolve();
            }
        })
    }
}

class AnnotatedStructureMismatchCollector {

    constructor(item) {
        this._item = item;
        this._results = null;
    }

    getMismatches() {
        return this._collectMismatches();
    }

    _checkLayoutsEqual(layout, otherLayout) {
        const equal = this._compareFloats(layout.x, otherLayout.x) &&
            this._compareFloats(layout.y, otherLayout.y) &&
            this._compareFloats(layout.w, otherLayout.w) &&
            this._compareFloats(layout.h, otherLayout.h);
        return equal;
    }

    _compareFloats(f1, f2) {
        // Account for rounding errors.
        const delta = Math.abs(f1 - f2);
        return (delta < 0.1);
    }

    _collectMismatches() {
        this._results = [];
        this._collectRecursive(this._item, []);
        const results = this._results;
        this._results = null;
        return results.map(path => `[${path}]`);
    }

    _collectRecursive(item, location) {
        if (!this._checkLayoutsEqual(
            {x: item.x, y: item.y, w: item.w, h: item.h},
            item.r ? {x: item.r[0], y: item.r[1], w: item.r[2], h: item.r[3]} : {x: 0, y: 0, w: 0, h: 0})
        ) {
            this._results.push(location.join("."));
        }
        item.children.forEach((subItem, index) => {
            const subLocation = location.concat([index]);
            this._collectRecursive(subItem, subLocation);
        });
    }

}