#!/bin/bash
set -e

# Build the web frontend
echo "Building web frontend..."
cd web
npm install
npm run build
cd ..

# Build the desktop app
echo "Building desktop app..."
cd desktop
npm install
npm run tauri build
cd ..

echo "Desktop app built successfully!"
echo "You can find the application in target/release/bundle/"
