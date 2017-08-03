/**
 * Copyright Metrological, 2017
 */

let DefaultShader = require('../../core/DefaultShader');

class Light3dShader extends DefaultShader {
    constructor(stage) {
        super(stage, Light3dShader.vertexShaderSource, Light3dShader.fragmentShaderSrc);

        this._strength = 1;
        this._ambient = 0;
        this._fudge = 0.4;
    }

    init(vboContext) {
        super.init(vboContext)

        let gl = vboContext.gl;
        this._strengthUniform = gl.getUniformLocation(this.glProgram, "strength");
        this._ambientUniform = gl.getUniformLocation(this.glProgram, "ambient");
        this._fudgeUniform = gl.getUniformLocation(this.glProgram, "fudge");

        this._rotAttribute = gl.getAttribLocation(this.glProgram, "rot");
        this._pivotAttribute = gl.getAttribLocation(this.glProgram, "pivot");
        this._xyRotAttribute = gl.getAttribLocation(this.glProgram, "xyRot");

    }

    drawElements(vboContext, offset, length) {
        let gl = vboContext.gl;

        let byteOffset = (offset + length) * vboContext.bytesPerQuad;

        gl.vertexAttribPointer(this._rotAttribute, 3, gl.FLOAT, false, 28, byteOffset - (offset * this.getExtraBufferSizePerQuad()));
        gl.enableVertexAttribArray(this._rotAttribute);

        gl.vertexAttribPointer(this._pivotAttribute, 2, gl.FLOAT, false, 28, byteOffset - (offset * this.getExtraBufferSizePerQuad()) + 12);
        gl.enableVertexAttribArray(this._pivotAttribute);

        gl.vertexAttribPointer(this._xyRotAttribute, 2, gl.FLOAT, false, 28, byteOffset - (offset * this.getExtraBufferSizePerQuad()) + 20);
        gl.enableVertexAttribArray(this._xyRotAttribute);

        let base = byteOffset / 4;
        for (let i = 0; i < length; i++) {
            let viewRenderer = vboContext.getViewRenderer(i);
            let s = viewRenderer.shaderSettings;
            let z = s.totalZ;
            let rx = s.totalRx;
            let ry = s.totalRy;

            let pivotX = s.pivotX;
            let pivotY = s.pivotY;

            let rotCos = s.rotCos;
            let rotSin = s.rotSin;

            for (let j = 0; j < 28; j+=7) {
                vboContext.vboBufferFloat[base + i * 28 + j] = rx
                vboContext.vboBufferFloat[base + i * 28 + j + 1] = ry
                vboContext.vboBufferFloat[base + i * 28 + j + 2] = z
                vboContext.vboBufferFloat[base + i * 28 + j + 3] = pivotX
                vboContext.vboBufferFloat[base + i * 28 + j + 4] = pivotY
                vboContext.vboBufferFloat[base + i * 28 + j + 5] = rotCos
                vboContext.vboBufferFloat[base + i * 28 + j + 6] = rotSin
            }
        }

        super.drawElements(vboContext, offset, length);

        gl.disableVertexAttribArray(this._rotAttribute);
        gl.disableVertexAttribArray(this._pivotAttribute);
        gl.disableVertexAttribArray(this._xyRotAttribute);
    }

    getExtraBufferSizePerQuad() {
        return 28 * 4; // 20 bytes * 4 vertices.
    }

    setupExtra(vboContext) {
        super.setupExtra(vboContext)

        let gl = vboContext.gl
        gl.uniform1f(this._strengthUniform, this._strength)
        gl.uniform1f(this._ambientUniform, this._ambient)
        gl.uniform1f(this._fudgeUniform, this._fudge)
    }

    set strength(v) {
        this._strength = v;
        this.redraw();
    }

    get strength() {
        return this._strength;
    }

    set ambient(v) {
        this._ambient = v;
        this.redraw();
    }

    get ambient() {
        return this._ambient;
    }

    set fudge(v) {
        this._fudge = v;
        this.redraw();
    }

    get fudge() {
        return this._fudge;
    }

    hasViewSettings() {
        return true;
    }

    createViewSettings(view) {
        return new Light3dShaderViewSettings(this, view);
    }
}

Light3dShader.vertexShaderSource = `
    #ifdef GL_ES
    precision lowp float;
    #endif
    attribute vec2 aVertexPosition;
    attribute vec2 aTextureCoord;
    attribute vec4 aColor;
    uniform mat4 projectionMatrix;
    varying vec2 vTextureCoord;
    varying vec4 vColor;

    attribute vec3 rot;
    attribute vec2 pivot;
    attribute vec2 xyRot;
    uniform float fudge;
    uniform float strength;
    uniform float ambient;
    varying float light;

    void main(void){
        vec4 pos = projectionMatrix * vec4(aVertexPosition, 0, 1);

        float rx = rot.x;
        float ry = rot.y;
        float z = rot.z;

        /* Translate to pivot position */
        vec4 pivotPos = projectionMatrix * vec4(pivot, 0, 1);
        pivotPos.w = 0.0;
        pos -= pivotPos;
        
        /* Undo XY rotation */
        mat2 iRotXy = mat2( xyRot.x, xyRot.y, 
                           -xyRot.y, xyRot.x);
        pos.xy = iRotXy * pos.xy;

        /* Perform rotations */
        gl_Position.x = cos(rx) * pos.x - sin(rx) * pos.z;
        gl_Position.y = pos.y;
        gl_Position.z = sin(rx) * pos.x + cos(rx) * pos.z;
        
        pos.y = cos(ry) * gl_Position.y - sin(ry) * gl_Position.z;
        gl_Position.z = sin(ry) * gl_Position.y + cos(ry) * gl_Position.z;
        gl_Position.y = pos.y;
        
        /* Set depth perspective */
        gl_Position.w = 1.0 + fudge * (z + gl_Position.z);
        
        /* Set z to 0 because we don't want to perform z-clipping */
        gl_Position.z = 0.0;
        
        /* Redo XY rotation */
        iRotXy[0][1] = -iRotXy[0][1];
        iRotXy[1][0] = -iRotXy[1][0];
        gl_Position.xy = iRotXy * gl_Position.xy; 

        /* Undo translate to pivot position */
        gl_Position += pivotPos;

        /* Use texture normal to calculate light strength */ 
        light = ambient + strength * abs(cos(ry) * cos(rx));
        
        vTextureCoord = aTextureCoord;
        vColor = aColor;
    }
`;

Light3dShader.fragmentShaderSrc = `
    #ifdef GL_ES
    precision lowp float;
    #endif
    varying vec2 vTextureCoord;
    varying vec4 vColor;
    varying float light;
    uniform sampler2D uSampler;
    void main(void){
        vec4 rgba = texture2D(uSampler, vTextureCoord);
        rgba.rgb = rgba.rgb * light;
        gl_FragColor = rgba * vColor;
    }
`;

let ShaderSettings = require('../../core/ShaderSettings');

class Light3dShaderViewSettings extends ShaderSettings {

    constructor(shader, viewRenderer) {
        super(shader, viewRenderer);

        this._z = 0;
        this._totalZ = 0;
        this._rx = 0;
        this._totalRx = 0;
        this._ry = 0;
        this._totalRy = 0;

        this._pivotX = 0;
        this._pivotY = 0;

        this._rotCos = 1;
        this._rotSin = 0;
    }

    get z() {
        return this._z;
    }

    set z(v) {
        if (this._z !== v) {
            this._z = v;
            
            this._recalc();
        }
    }

    get totalZ() {
        return this._totalZ;
    }

    get rx() {
        return this._rx;
    }

    set rx(v) {
        if (this._rx !== v) {
            this._rx = v;

            this._recalc();
        }
    }

    get totalRx() {
        return this._totalRx;
    }

    get ry() {
        return this._ry;
    }

    set ry(v) {
        if (this._ry !== v) {
            this._ry = v;

            this._recalc();
        }
    }

    get totalRy() {
        return this._totalRy;
    }

    get pivotX() {
        return this._pivotX
    }

    get pivotY() {
        return this._pivotY
    }

    get rotCos() {
        return this._rotCos;
    }

    get rotSin() {
        return this._rotSin;
    }

    update() {
        let vr = this._viewRenderer;
        let view = vr._view;

        let coords = vr.getAbsoluteCoords(vr.rw * view.pivotX, vr.rh * view.pivotY);

        let x = coords[0];
        let y = coords[1];

        if (!vr._worldTc) {
            this._rotCos = 1;
            this._rotSin = 0;
        } else {
            this._rotCos = vr._worldTa;
            this._rotSin = vr._worldTc;
            let sq = vr._worldTa * vr._worldTa + vr._worldTc * vr._worldTc;
            if (sq !== 1) {
                let ilen = 1.0 / Math.sqrt(sq);
                this._rotCos *= ilen;
                this._rotSin *= ilen;
            }
        }

        this._pivotX = x;
        this._pivotY = y;

        this._totalRx = this._rx;
        this._totalRy = this._ry;

        this._totalZ = this._z;
        let parent = this._viewRenderer._parent;
        if (parent && parent.activeShader === this._shader) {
            this._totalRx += parent.shaderSettings._totalRx;
            this._totalRy += parent.shaderSettings._totalRy;
            this._totalZ += parent.shaderSettings._totalZ;
        }
    }

}


module.exports = Light3dShader;