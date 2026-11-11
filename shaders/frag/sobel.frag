#version 300 es
precision highp float;

in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_texture;
uniform vec2 u_textureSize;

uniform int uPass; // 0: horizontal gaussian blur, 1: vertical gaussian blur, 2: sobel edge detection

uniform int uRadius; // Blur radius in pixels (0..MAX_RADIUS), the blur passes are skipped entirely when 0
uniform float uSigma; // Blur sigma, falls back to radius / 2 when <= 0

uniform float uThreshold; // Edge threshold applied on the gradient magnitude of the (blurred) input

const int MAX_RADIUS = 8; // Radius cap, the blur loops are unrolled against this constant (WebGL1-safe)
const float EDGE_SOFTNESS = 0.05; // Smoothstep softness around the edge threshold to avoid hard frame-to-frame cuts

/**
 * Separable gaussian blur along the given direction.
 * Weights are computed on the fly and normalized, so any radius/sigma combination stays brightness-preserving.
 */
vec4 gaussianBlur(vec2 direction) {
    vec2 texelSize = 1.0f / u_textureSize;

    float sigma = uSigma > 0.0f ? uSigma : max(float(uRadius) * 0.5f, 0.001f);

    vec4 sum = texture(u_texture, v_texCoord); // Center tap, weight = exp(0) = 1
    float weightSum = 1.0f;

    for(int i = 1; i <= MAX_RADIUS; i++) {
        if(i > uRadius) break; // Uniform break, the loop bound itself stays a compile-time constant

        float weight = exp(-float(i * i) / (2.0f * sigma * sigma));
        vec2 offset = direction * float(i) * texelSize;

        sum += weight * texture(u_texture, v_texCoord + offset);
        sum += weight * texture(u_texture, v_texCoord - offset);
        weightSum += 2.0f * weight;
    }

    return sum / weightSum;
}

void main() {
    if(uPass == 0) { // Horizontal blur pass
        fragColor = gaussianBlur(vec2(1.0f, 0.0f));
        return;
    }

    if(uPass == 1) { // Vertical blur pass
        fragColor = gaussianBlur(vec2(0.0f, 1.0f));
        return;
    }

    // Sobel edge detection pass (uPass == 2)
    vec2 texelSize = 1.0f / u_textureSize;

    float kernelX[9];
    float kernelY[9];

    kernelX[0] = -1.0f; kernelX[1] = 0.0f; kernelX[2] = 1.0f;
    kernelX[3] = -2.0f; kernelX[4] = 0.0f; kernelX[5] = 2.0f;
    kernelX[6] = -1.0f; kernelX[7] = 0.0f; kernelX[8] = 1.0f;

    kernelY[0] = -1.0f; kernelY[1] = -2.0f; kernelY[2] = -1.0f;
    kernelY[3] = 0.0f; kernelY[4] = 0.0f; kernelY[5] = 0.0f;
    kernelY[6] = 1.0f; kernelY[7] = 2.0f; kernelY[8] = 1.0f;

    vec3 texColor[9];
    for(int i = -1; i <= 1; i++) {
        for(int j = -1; j <= 1; j++) {
            texColor[(i + 1) * 3 + (j + 1)] = texture(u_texture, v_texCoord + vec2(i, j) * texelSize).rgb;
        }
    }

    vec3 sobelX = vec3(0.0f);
    vec3 sobelY = vec3(0.0f);

    for(int i = 0; i < 9; i++) {
        sobelX += kernelX[i] * texColor[i];
        sobelY += kernelY[i] * texColor[i];
    }

    vec3 sobel = sqrt(sobelX * sobelX + sobelY * sobelY);
    float intensity = length(sobel) / sqrt(3.0f);

    // Soft edge confidence on the (blurred) gradient magnitude, no hard cut
    float confidence = smoothstep(uThreshold - EDGE_SOFTNESS, uThreshold + EDGE_SOFTNESS, intensity);

    float sobelXR = sobelX.r;
    float sobelYR = sobelY.r;

    // Calculate the angle of the gradient in radians
    float angleRad = atan(sobelYR, sobelXR);

    // Convert the angle from radians to degrees
    float angleDeg = degrees(angleRad);

    // Determine the direction bin based on the angle (0 = no edge, 0.1..0.9 map to the 8 edge characters)
    float directionBin = 0.0f;

    if(angleDeg >= -22.5f && angleDeg < 22.5f) {
        directionBin = 0.1f; // "-"
    } else if(angleDeg >= 22.5f && angleDeg < 67.5f) {
        directionBin = 0.2f; // "/"
    } else if(angleDeg >= 67.5f && angleDeg < 112.5f) {
        directionBin = 0.3f; // "|"
    } else if(angleDeg >= 112.5f && angleDeg < 157.5f) {
        directionBin = 0.4f; // "\"
    } else if(angleDeg >= 157.5f || angleDeg < -157.5f) {
        directionBin = 0.5f; // "-"
    } else if(angleDeg >= -157.5f && angleDeg < -112.5f) {
        directionBin = 0.7f; // "/"
    } else if(angleDeg >= -112.5f && angleDeg < -67.5f) {
        directionBin = 0.8f; // "|"
    } else if(angleDeg >= -67.5f && angleDeg < -22.5f) {
        directionBin = 0.9f; // "\"
    }

    // Luminance of the (blurred) input, used by the ascii shader as the brightness character fallback
    float luminance = dot(texColor[4], vec3(0.299f, 0.587f, 0.114f));

    // r: direction bin (0 when the edge got suppressed), g/b: edge confidence, a: blurred luminance
    fragColor = vec4(confidence > 0.0f ? directionBin : 0.0f, confidence, confidence, luminance);
}
