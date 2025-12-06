#!/bin/bash

# Create blue calendar icons for the extension

# Check if ImageMagick is installed
if ! command -v convert &> /dev/null; then
    echo "ImageMagick is not installed. Install it with: brew install imagemagick"
    exit 1
fi

# Create a blue calendar icon for each size
for size in 16 48 128; do
  # Calculate proportional sizes
  border=$((size / 8))
  corner=$((size / 16))
  topbar=$((size / 5))
  
  convert -size ${size}x${size} xc:none \
    -fill '#4a90e2' \
    -draw "roundrectangle 0,0 $((size-1)),$((size-1)) ${corner},${corner}" \
    -fill white \
    -draw "rectangle ${border},$((topbar + border)) $((size-border-1)),$((size-border-1))" \
    -fill '#4a90e2' \
    -draw "rectangle 0,0 $((size-1)),${topbar}" \
    public/icon${size}.png
done

echo "Blue calendar icons created successfully!"
echo "Run 'npm run build' to copy them to dist folder"
