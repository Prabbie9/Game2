#!/bin/sh
# Re-installs the build-only tools in a fresh container (not needed to play).
set -e; mkdir -p /opt/tools && cd /opt/tools
[ -x FBX2glTF ] || { curl -sL -o FBX2glTF https://github.com/facebookincubator/FBX2glTF/releases/download/v0.9.7/FBX2glTF-linux-x64 && chmod +x FBX2glTF; }
[ -d blender-4.2.3-linux-x64 ] || { curl -sL https://download.blender.org/release/Blender4.2/blender-4.2.3-linux-x64.tar.xz | tar xJ; }
