# The following five lines of boilerplate have to be in your project's
# CMakeLists in this exact order for cmake to work correctly
cmake_minimum_required(VERSION 3.16)

set(PROJECT_VER "2.0.44")
add_definitions(-DFIRMWARE_VERSION=\"${PROJECT_VER}\")

# Enable local HTTP control and serial wake/stop (always on for dev builds)
set(STACKCHAN_ENABLE_DEV_SERIAL_WAKE_STOP ON CACHE BOOL "Enable serial wake/stop" FORCE)
set(STACKCHAN_ENABLE_DEV_LOCAL_HTTP_CONTROL ON CACHE BOOL "Enable local HTTP control server on port 18080" FORCE)

# Add this line to disable the specific warning
add_compile_options(-Wno-missing-field-initializers)

include($ENV{IDF_PATH}/tools/cmake/project.cmake)
project(stack-chan)
