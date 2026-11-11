#version 300 es
precision highp float;

uniform sampler2D u_characterTexture; // Texture containing the characters of the charset
uniform float u_charsetCols; // Number of columns in the charset texture
uniform float u_charsetRows; // Number of rows in the charset texture
uniform int u_totalChars; // Total number of characters in the charset texture

uniform sampler2D u_brightnessCharacterTexture; // Charset texture of the brightness pass (edges mode fallback)
uniform float u_brightnessCharsetCols; // Number of columns in the brightness charset texture
uniform float u_brightnessCharsetRows; // Number of rows in the brightness charset texture
uniform int u_brightnessTotalChars; // Total number of characters in the brightness charset texture

uniform sampler2D u_sketchTexture; // Texture containing the original simulation colors
uniform sampler2D u_edgesTexture; // Sobel output (r: direction bin, g/b: edge confidence, a: blurred luminance)

uniform vec2 u_gridCellDimensions; // Number of columns and rows in the grid
uniform vec2 u_gridPixelDimensions; // The width and height of the whole grid in pixels
uniform vec2 u_gridOffsetDimensions; // The offset of the grid in pixels

uniform vec3 u_characterColor; // Color of the characters (used when u_characterColorMode is 1 (fixed color))
uniform int u_characterColorMode; // Indicates whether to use the character color or the simulation color
uniform vec3 u_backgroundColor; // Color of the background (used when u_backgroundColorMode is 1 (fixed color))
uniform int u_backgroundColorMode; // Indicates whether to use the background color or the simulation color

uniform int u_invertMode; // Indicates whether to invert the character colors

uniform int u_renderMode; // Indicates whether to render including the edges or brightness only

out vec4 fragColor;

/**
 * Computes the texture coordinate of a character in a charset texture.
 */
vec2 charTexCoord(int charIndex, float charsetCols, float charsetRows, vec2 gridCoord) {
    int charCol = charIndex % int(charsetCols);
    int charRow = charIndex / int(charsetCols);

    vec2 charCoord = vec2(float(charCol) / charsetCols, float(charRow) / charsetRows);
    vec2 fractionalPart = fract(gridCoord) * vec2(1.0f / charsetCols, 1.0f / charsetRows);

    return charCoord + fractionalPart;
}

void main() {
    vec2 adjustedCoord = (gl_FragCoord.xy - u_gridOffsetDimensions) / u_gridPixelDimensions;

    if(adjustedCoord.x < 0.0f || adjustedCoord.x > 1.0f || adjustedCoord.y < 0.0f || adjustedCoord.y > 1.0f) {
        fragColor = vec4(u_backgroundColor, 1.0);
        return;
    }

    // Calculate the grid coordinate
    vec2 gridCoord = adjustedCoord * u_gridCellDimensions;
    vec2 cellCoord = floor(gridCoord);
    vec2 centerCoord = cellCoord + vec2(0.5f);
    vec2 baseCoord = centerCoord / u_gridCellDimensions;

    vec4 sketchColor; // Simulation color
    vec4 charColor; // Color of the selected character in the charset texture

    if(u_renderMode == 1) { // edges mode
        vec4 edgeData = texture(u_edgesTexture, baseCoord);
        sketchColor = texture(u_sketchTexture, baseCoord);

        float confidence = edgeData.g; // Soft edge confidence from the sobel pass, no re-thresholding here
        bool isEdge = confidence > 0.0f;

        // Edge cells pick their character from the direction bin, suppressed cells fall back
        // to a brightness character based on the blurred luminance instead of going blank
        int edgeCharIndex = min(int(edgeData.r * float(u_totalChars)), u_totalChars - 1);
        int brightnessCharIndex = min(int(edgeData.a * float(u_brightnessTotalChars)), u_brightnessTotalChars - 1);

        vec2 edgeTexCoord = charTexCoord(edgeCharIndex, u_charsetCols, u_charsetRows, gridCoord);
        vec2 brightnessTexCoord = charTexCoord(brightnessCharIndex, u_brightnessCharsetCols, u_brightnessCharsetRows, gridCoord);

        charColor = isEdge ? texture(u_characterTexture, edgeTexCoord) : texture(u_brightnessCharacterTexture, brightnessTexCoord);

        if(isEdge) {
            charColor.a *= confidence; // Fade the edge character in/out with the soft confidence
        }
    } else { // Brightness mode
        sketchColor = texture(u_sketchTexture, baseCoord);

        // Calculate the brightness from the sketch color
        float brightness = dot(sketchColor.rgb, vec3(0.299f, 0.587f, 0.114f));

        // Map the brightness to a character index
        int charIndex = min(int(brightness * float(u_totalChars)), u_totalChars - 1);

        charColor = texture(u_characterTexture, charTexCoord(charIndex, u_charsetCols, u_charsetRows, gridCoord));
    }

    // If the inversion mode is enabled, invert the character color
    if(u_invertMode == 1) {
        charColor.a = 1.0f - charColor.a;
        charColor.rgb = vec3(1.0f);
    }

    // Calculate the final color of the character
    vec4 finalColor = (u_characterColorMode == 0) ? vec4(sketchColor.rgb * charColor.rgb, charColor.a) : vec4(u_characterColor * charColor.rgb, charColor.a);

    // If the background color mode is 0, mix the simulation color and the final color based on the character's alpha value
    // Otherwise, mix the background color and the final color based on the character's alpha value
    if(u_backgroundColorMode == 0) {
        fragColor = mix(vec4(sketchColor.rgb, 1.0f), finalColor, charColor.a);
    } else {
        fragColor = mix(vec4(u_backgroundColor, 1.0f), finalColor, charColor.a);
    }
}
