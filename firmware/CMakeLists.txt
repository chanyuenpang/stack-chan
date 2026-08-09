# The following five lines of boilerplate have to be in your project's
# CMakeLists in this exact order for cmake to work correctly
cmake_minimum_required(VERSION 3.16)

set(PROJECT_VER "2.0.45")
add_definitions(-DFIRMWARE_VERSION=\"${PROJECT_VER}\")

# Enable local HTTP control and serial wake/stop (always on for dev builds)
set(STACKCHAN_ENABLE_DEV_SERIAL_WAKE_STOP ON CACHE BOOL "Enable serial wake/stop" FORCE)
set(STACKCHAN_ENABLE_DEV_LOCAL_HTTP_CONTROL ON CACHE BOOL "Enable local HTTP control server on port 18080" FORCE)

# Add this line to disable the specific warning
add_compile_options(-Wno-missing-field-initializers)

# The complete firmware has enough component include paths to exceed the
# Windows CreateProcess command-line limit after a clean CMake regeneration.
set(CMAKE_NINJA_FORCE_RESPONSE_FILE ON CACHE BOOL "Use Ninja response files" FORCE)

include($ENV{IDF_PATH}/tools/cmake/project.cmake)
project(stack-chan)

# The retired private Wi-Fi Audio MVP needs four managed-component patches.
# The official XiaoZhi local-Dock profile must build the unpatched upstream
# transport instead. Switching profiles therefore applies or reverses the
# exact same patch set reproducibly after dependencies are materialized.
set(STACKCHAN_REPOSITORY_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/..")
set(STACKCHAN_ESP_ML307_DIR "firmware/managed_components/78__esp-ml307")
set(STACKCHAN_ESP_ML307_PATCHES
    "${CMAKE_CURRENT_SOURCE_DIR}/patches/esp-ml307-wifi-audio-bounded-send.patch"
    "${CMAKE_CURRENT_SOURCE_DIR}/patches/esp-ml307-wifi-audio-plain-tcp.patch"
    "${CMAKE_CURRENT_SOURCE_DIR}/patches/esp-ml307-wifi-audio-receive-limit.patch"
    "${CMAKE_CURRENT_SOURCE_DIR}/patches/esp-ml307-wifi-audio-websocket-lifecycle.patch")
set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS
    ${STACKCHAN_ESP_ML307_PATCHES})
set(STACKCHAN_XIAOZHI_LOCAL_DOCK_PATCH
    "${CMAKE_CURRENT_SOURCE_DIR}/patches/xiaozhi-local-dock.patch")
set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS
    "${STACKCHAN_XIAOZHI_LOCAL_DOCK_PATCH}")
if(CONFIG_STACKCHAN_WIFI_AUDIO_MVP)
    find_package(Git REQUIRED)
    foreach(STACKCHAN_ESP_ML307_PATCH IN LISTS STACKCHAN_ESP_ML307_PATCHES)
        execute_process(
            COMMAND "${GIT_EXECUTABLE}" apply "--directory=${STACKCHAN_ESP_ML307_DIR}"
                    --reverse --check "${STACKCHAN_ESP_ML307_PATCH}"
            WORKING_DIRECTORY "${STACKCHAN_REPOSITORY_ROOT}"
            RESULT_VARIABLE STACKCHAN_ESP_ML307_PATCH_ALREADY_APPLIED
            OUTPUT_QUIET ERROR_QUIET)
        if(NOT STACKCHAN_ESP_ML307_PATCH_ALREADY_APPLIED EQUAL 0)
            execute_process(
                COMMAND "${GIT_EXECUTABLE}" apply "--directory=${STACKCHAN_ESP_ML307_DIR}"
                        --check "${STACKCHAN_ESP_ML307_PATCH}"
                WORKING_DIRECTORY "${STACKCHAN_REPOSITORY_ROOT}"
                RESULT_VARIABLE STACKCHAN_ESP_ML307_PATCH_CHECK
                OUTPUT_VARIABLE STACKCHAN_ESP_ML307_PATCH_CHECK_OUT
                ERROR_VARIABLE STACKCHAN_ESP_ML307_PATCH_CHECK_ERR)
            if(NOT STACKCHAN_ESP_ML307_PATCH_CHECK EQUAL 0)
                message(FATAL_ERROR
                    "esp-ml307 Wi-Fi Audio patch no longer applies cleanly.\n"
                    "${STACKCHAN_ESP_ML307_PATCH_CHECK_OUT}${STACKCHAN_ESP_ML307_PATCH_CHECK_ERR}")
            endif()
            execute_process(
                COMMAND "${GIT_EXECUTABLE}" apply "--directory=${STACKCHAN_ESP_ML307_DIR}"
                        "${STACKCHAN_ESP_ML307_PATCH}"
                WORKING_DIRECTORY "${STACKCHAN_REPOSITORY_ROOT}"
                RESULT_VARIABLE STACKCHAN_ESP_ML307_PATCH_RESULT)
            if(NOT STACKCHAN_ESP_ML307_PATCH_RESULT EQUAL 0)
                message(FATAL_ERROR "Failed to apply esp-ml307 Wi-Fi Audio patch")
            endif()
        endif()
    endforeach()
elseif(CONFIG_STACKCHAN_XIAOZHI_LOCAL_DOCK)
    find_package(Git REQUIRED)
    set(STACKCHAN_ESP_ML307_WEBSOCKET_HEADER
        "${CMAKE_CURRENT_SOURCE_DIR}/managed_components/78__esp-ml307/include/web_socket.h")
    set(STACKCHAN_ESP_ML307_WEBSOCKET_SOURCE
        "${CMAKE_CURRENT_SOURCE_DIR}/managed_components/78__esp-ml307/src/web_socket.cc")
    file(READ "${STACKCHAN_ESP_ML307_WEBSOCKET_HEADER}" STACKCHAN_ESP_ML307_HEADER_TEXT)
    file(READ "${STACKCHAN_ESP_ML307_WEBSOCKET_SOURCE}" STACKCHAN_ESP_ML307_SOURCE_TEXT)
    string(FIND "${STACKCHAN_ESP_ML307_HEADER_TEXT}" "void Abort();"
        STACKCHAN_ESP_ML307_PRIVATE_HEADER_API)
    string(FIND "${STACKCHAN_ESP_ML307_SOURCE_TEXT}" "void WebSocket::Abort()"
        STACKCHAN_ESP_ML307_PRIVATE_SOURCE_API)

    if(STACKCHAN_ESP_ML307_PRIVATE_HEADER_API GREATER_EQUAL 0 AND
       STACKCHAN_ESP_ML307_PRIVATE_SOURCE_API GREATER_EQUAL 0)
        # These private patches were applied in order and overlap in
        # WebSocket/TCP sources. Unwind the stack in strict reverse order.
        set(STACKCHAN_ESP_ML307_REVERSE_PATCHES ${STACKCHAN_ESP_ML307_PATCHES})
        list(REVERSE STACKCHAN_ESP_ML307_REVERSE_PATCHES)
        foreach(STACKCHAN_ESP_ML307_PATCH IN LISTS STACKCHAN_ESP_ML307_REVERSE_PATCHES)
            execute_process(
                COMMAND "${GIT_EXECUTABLE}" apply "--directory=${STACKCHAN_ESP_ML307_DIR}"
                        --reverse --check "${STACKCHAN_ESP_ML307_PATCH}"
                WORKING_DIRECTORY "${STACKCHAN_REPOSITORY_ROOT}"
                RESULT_VARIABLE STACKCHAN_ESP_ML307_PATCH_REVERSE_CHECK
                OUTPUT_VARIABLE STACKCHAN_ESP_ML307_PATCH_CHECK_OUT
                ERROR_VARIABLE STACKCHAN_ESP_ML307_PATCH_CHECK_ERR)
            if(NOT STACKCHAN_ESP_ML307_PATCH_REVERSE_CHECK EQUAL 0)
                message(FATAL_ERROR
                    "Cannot unwind esp-ml307 private patches in reverse order.\n"
                    "${STACKCHAN_ESP_ML307_PATCH_CHECK_OUT}${STACKCHAN_ESP_ML307_PATCH_CHECK_ERR}")
            endif()
            execute_process(
                COMMAND "${GIT_EXECUTABLE}" apply "--directory=${STACKCHAN_ESP_ML307_DIR}"
                        --reverse "${STACKCHAN_ESP_ML307_PATCH}"
                WORKING_DIRECTORY "${STACKCHAN_REPOSITORY_ROOT}"
                RESULT_VARIABLE STACKCHAN_ESP_ML307_PATCH_REVERSE_RESULT)
            if(NOT STACKCHAN_ESP_ML307_PATCH_REVERSE_RESULT EQUAL 0)
                message(FATAL_ERROR "Failed to restore the official esp-ml307 source")
            endif()
        endforeach()
    elseif(NOT (STACKCHAN_ESP_ML307_PRIVATE_HEADER_API EQUAL -1 AND
                STACKCHAN_ESP_ML307_PRIVATE_SOURCE_API EQUAL -1))
        message(FATAL_ERROR "esp-ml307 WebSocket source/header are in a mixed private/official state")
    endif()

    execute_process(
        COMMAND "${GIT_EXECUTABLE}" apply --directory=firmware/xiaozhi-esp32
                --reverse --check "${STACKCHAN_XIAOZHI_LOCAL_DOCK_PATCH}"
        WORKING_DIRECTORY "${STACKCHAN_REPOSITORY_ROOT}"
        RESULT_VARIABLE STACKCHAN_XIAOZHI_LOCAL_PATCH_APPLIED
        OUTPUT_QUIET ERROR_QUIET)
    if(NOT STACKCHAN_XIAOZHI_LOCAL_PATCH_APPLIED EQUAL 0)
        execute_process(
            COMMAND "${GIT_EXECUTABLE}" apply --directory=firmware/xiaozhi-esp32
                    --check "${STACKCHAN_XIAOZHI_LOCAL_DOCK_PATCH}"
            WORKING_DIRECTORY "${STACKCHAN_REPOSITORY_ROOT}"
            RESULT_VARIABLE STACKCHAN_XIAOZHI_LOCAL_PATCH_CHECK
            OUTPUT_VARIABLE STACKCHAN_XIAOZHI_LOCAL_PATCH_CHECK_OUT
            ERROR_VARIABLE STACKCHAN_XIAOZHI_LOCAL_PATCH_CHECK_ERR)
        if(NOT STACKCHAN_XIAOZHI_LOCAL_PATCH_CHECK EQUAL 0)
            message(FATAL_ERROR
                "XiaoZhi local-Dock patch no longer applies cleanly.\n"
                "${STACKCHAN_XIAOZHI_LOCAL_PATCH_CHECK_OUT}${STACKCHAN_XIAOZHI_LOCAL_PATCH_CHECK_ERR}")
        endif()
        execute_process(
            COMMAND "${GIT_EXECUTABLE}" apply --directory=firmware/xiaozhi-esp32
                    "${STACKCHAN_XIAOZHI_LOCAL_DOCK_PATCH}"
            WORKING_DIRECTORY "${STACKCHAN_REPOSITORY_ROOT}"
            RESULT_VARIABLE STACKCHAN_XIAOZHI_LOCAL_PATCH_RESULT)
        if(NOT STACKCHAN_XIAOZHI_LOCAL_PATCH_RESULT EQUAL 0)
            message(FATAL_ERROR "Failed to apply XiaoZhi local-Dock authentication patch")
        endif()
    endif()
endif()
