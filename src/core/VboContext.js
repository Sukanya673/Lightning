/**
 * Copyright Metrological, 2017
 */

class VboContext {

    constructor(stage) {
        this.stage = stage;

        this.vboParamsBuffer = new ArrayBuffer(16 * 4 * 16384 * 2);
        this.vboBufferFloat = new Float32Array(this.vboParamsBuffer);
        this.vboBufferUint = new Uint32Array(this.vboParamsBuffer);
        this.vboIndex = 0;

        this.vboViewRenderers = [];
        this.vboGlTextures = [];

        // Current shader info.
        this.shader = null;
        this.shaderOwner = null;

        this.bytesPerQuad = 64;

        this.n = 0;

        this.updateTreeOrder = 0;
        this.updateTreeOrderForceUpdate = 0;

        this.staticStage = false;

        this._activeShaders = new Set();

        this._renderTargetStack = [];

        this._renderTarget = null;

        this._overrideGlTexture = null;

        // Used for renderAsTexture in the update/render loop to disable the world clipping context (and temporarily create a new one)
        this.ignoredClippingParent = null;

        let DefaultShader = require('./DefaultShader');
        this.defaultShader = new DefaultShader(this.stage);
        this.initShader(this.defaultShader);

        this.initSharedShaderData();
    }

    destroy() {
        this.gl.deleteBuffer(this.paramsGlBuffer);
        this.gl.deleteBuffer(this.quadsGlBuffer);
        this._activeShaders.forEach(shader => {this.destroyShader(shader)});
    }

    initSharedShaderData() {
        let gl = this.gl;

        // Create new sharable buffer for params.
        this.paramsGlBuffer = gl.createBuffer();

        // Init webgl arrays.
        let allIndices = new Uint16Array(VboContext.MAX_QUADS * 6);

        // fill the indices with the quads to draw.
        for (let i = 0, j = 0; i < VboContext.MAX_QUADS * 6; i += 6, j += 4) {
            allIndices[i] = j;
            allIndices[i + 1] = j + 1;
            allIndices[i + 2] = j + 2;
            allIndices[i + 3] = j;
            allIndices[i + 4] = j + 2;
            allIndices[i + 5] = j + 3;
        }

        // The quads buffer can be (re)used to draw a range of quads.
        this.quadsGlBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.quadsGlBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, allIndices, gl.STATIC_DRAW);

        // The matrix that causes the [0,0 - W,H] box to map to [-1,-1 - 1,1] in the end results.
        this._projectionMatrix = new Float32Array([
            2/this.stage.options.renderWidth, 0, 0, 0,
            0, -2/this.stage.options.renderHeight, 0, 0,
            0, 0, 1, 0,
            -1, 1, 0, 1
        ]);
    }

    initShader(shader) {
        shader.init(this);
        this._activeShaders.add(shader);
    }

    destroyShader(shader) {
        this._activeShaders.delete(shader);
    }

    reset() {
        this.vboIndex = 0;
        this.vboViewRenderers = [];
        this.vboGlTextures = [];
        this.textureAtlasGlTexture = this.stage.textureAtlas ? this.stage.textureAtlas.texture : null;
        this.lastVboGlTexture = null;
        this.n = 0;
        this.updateTreeOrder = 0;

        this.shader = null;
        this._renderTargetStack = []
        this._overrideGlTexture = null;
    }

    layout() {
        this.root.layout();
    }

    resetGl() {
        let gl = this.gl;
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0,0,this.stage.options.w,this.stage.options.h);

        let glClearColor = this.stage.options.glClearColor;
        this.gl.clearColor(glClearColor[0], glClearColor[1], glClearColor[2], glClearColor[3]);
        this.gl.clear(gl.COLOR_BUFFER_BIT);
    }

    updateAndRender() {
        this.reset();

        this.root.update();

        this.resetGl();

        // Setup the first added vbo shader.
        this.setupShader(this.root);

        this.root.render();

        this.flush();

        if (this.stage.textureAtlas && this.stage.options.debugTextureAtlas) {
            this.renderDebugTextureAtlas();
        }

        // Cleanup the latest added vbo shader.
        this.shader.cleanup(this);

        this.staticStage = true;
    }

    /**
     * Specifically for renderAsTexture rendering.
     * @param texture
     */
    overrideAddVboTexture(texture) {
        this._overrideGlTexture = texture;
    }

    addVbo(viewRenderer) {
        let glTexture = this._overrideGlTexture;
        if (!glTexture) {
            let textureSource = viewRenderer._displayedTextureSource;
            glTexture = textureSource.inTextureAtlas ? this.textureAtlasGlTexture : textureSource.glTexture;
        }

        this.vboGlTextures.push(glTexture);
        this.vboViewRenderers.push(viewRenderer);

        this.vboIndex += 16;

        if (this.vboOffset > VboContext.MAX_QUADS - 10) {
            this.flush();
        }
    }

    setupShader(viewRenderer, specificShader) {
        let shader = specificShader || viewRenderer.activeShader;

        if (!shader.initialized) {
            this.initShader(shader);
        }

        if (this.shader && (this.shader.constructor === shader.constructor)) {
            // We keep using the same shader, so we don't need to switch attributes.
        } else {
            let prevWasDefault = (this.shader && this.shader.isDefaultShader);
            let newIsDefault = (shader && shader.isDefaultShader);

            if (prevWasDefault && newIsDefault) {
                // All attributes are assumed to stay in the same order.
                // Allow to only setup additional attributes/uniforms.
                this.shader.cleanupExtraOnly(this);
                shader.setupExtraOnly(this);
            } else {
                if (this.shader) {
                    this.shader.cleanup(this);
                }
                shader.setup(this);
            }
        }

        this.shader = shader;
        this.shaderOwner = viewRenderer;
    }

    flush() {
        this.drawElements(0, this.vboOffset);
        this.vboIndex = 0;
        this.vboViewRenderers = [];
        this.vboGlTextures = [];
    }

    drawElements(offset, length) {
        this.shader.drawElements(this, offset, length);
    }

    renderDebugTextureAtlas() {
        this.setupShader(null, this.defaultShader);

        let size = Math.min(this.stage.options.w, this.stage.options.h);
        let vboIndex = this.vboIndex;
        this.vboBufferFloat[vboIndex++] = 0;
        this.vboBufferFloat[vboIndex++] = 0;
        this.vboBufferUint[vboIndex++] = 0x00000000;
        this.vboBufferUint[vboIndex++] = 0xFFFFFFFF;
        this.vboBufferFloat[vboIndex++] = size;
        this.vboBufferFloat[vboIndex++] = 0;
        this.vboBufferUint[vboIndex++] = 0x0000FFFF;
        this.vboBufferUint[vboIndex++] = 0xFFFFFFFF;
        this.vboBufferFloat[vboIndex++] = size;
        this.vboBufferFloat[vboIndex++] = size;
        this.vboBufferUint[vboIndex++] = 0xFFFFFFFF;
        this.vboBufferUint[vboIndex++] = 0xFFFFFFFF;
        this.vboBufferFloat[vboIndex++] = 0;
        this.vboBufferFloat[vboIndex++] = size;
        this.vboBufferUint[vboIndex++] = 0xFFFF0000;
        this.vboBufferUint[vboIndex] = 0xFFFFFFFF;
        this.vboGlTextures.push(this.textureAtlasGlTexture);
        this.vboViewRenderers.push(null);
        this.vboIndex += 16;

        this.flush();
    }

    getView(vboOffset) {
        return this.vboViewRenderers[vboOffset]._view;
    }

    getViewRenderer(vboOffset) {
        return this.vboViewRenderers[vboOffset];
    }

    getVboGlTexture(vboOffset) {
        return this.vboGlTextures[vboOffset];
    }

    getShaderOwner() {
        return this.shaderOwner;
    }

    get gl() {
        return this.stage.gl;
    }

    get vboOffset() {
        return this.vboIndex / 16;
    }

    createRenderGlTexture(w, h) {
        let gl = this.gl;

        let sourceTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, sourceTexture);

        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

        // We need a specific framebuffer for every render texture.
        sourceTexture.w = w;
        sourceTexture.h = h;
        sourceTexture.framebuffer = gl.createFramebuffer();
        sourceTexture.projectionMatrix = new Float32Array([
            2/w, 0, 0, 0,
            0, 2/h, 0, 0,
            0, 0, 1, 0,
            -1, -1, 0, 1
        ]);

        gl.bindFramebuffer(gl.FRAMEBUFFER, sourceTexture.framebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, sourceTexture, 0);

        return sourceTexture;
    }

    deleteRenderGlTexture(glTexture) {
        let gl = this.stage.gl;
        gl.deleteFramebuffer(glTexture.framebuffer);
        gl.deleteTexture(glTexture);
    }

    setRenderTarget(glTexture) {
        this._renderTargetStack.push(this._renderTarget)
        this._setRenderTarget(glTexture)
    }

    restoreRenderTarget() {
        this._setRenderTarget(this._renderTargetStack.pop());
    }

    _setRenderTarget(v) {
        let gl = this.stage.gl;

        this._renderTarget = v

        if (!v) {
            gl.bindFramebuffer(gl.FRAMEBUFFER, null)
            gl.viewport(0,0,this.stage.options.w,this.stage.options.h)
        } else {
            gl.bindFramebuffer(gl.FRAMEBUFFER, this._renderTarget.framebuffer)
            gl.viewport(0,0,this._renderTarget.w, this._renderTarget.h)

            // Clear texture.
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);
        }
    }

    getProjectionMatrix() {
        if (this._renderTarget) {
            return this._renderTarget.projectionMatrix;
        } else {
            return this._projectionMatrix;
        }
    }

    getViewportWidth() {
        if (this._renderTarget) {
            return this._renderTarget.w;
        } else {
            return this.stage.w;
        }
    }

    getViewportHeight() {
        if (this._renderTarget) {
            return this._renderTarget.h;
        } else {
            return this.stage.h;
        }
    }
}

/**
 * Max number of quads that can be rendered in one operation.
 * The memory usage is 64B * Renderer.MAX_QUADS.
 * @note if a sprite is being clipped or has borders, it may use more than 1 quad.
 * @type {number}
 */
VboContext.MAX_QUADS = 10000;

module.exports = VboContext;

let View = require('./View');
