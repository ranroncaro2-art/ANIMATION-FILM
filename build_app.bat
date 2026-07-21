@echo off
title AI Kids Animation Studio - Package Builder
echo ===================================================
echo     AI Kids Animation Studio - Build Standalone EXE
echo ===================================================
echo.

python build_full_pc_app.py

if %errorlevel% equ 0 (
    echo.
    echo [SUCCESS] Package build completed successfully!
    echo Distribution folder: dist\AI_Kids_Studio_App
    echo Setup Zip Package: dist\AI_Kids_Studio_Setup_v1.0.1.zip
) else (
    echo.
    echo [ERROR] Package build failed.
)

pause
