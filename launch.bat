@echo off
setlocal EnableExtensions

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

where uv >nul 2>nul
if errorlevel 1 (
  echo [ORGANUM] Error: 'uv' was not found on PATH.
  echo Install uv from https://docs.astral.sh/uv/ and retry.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [ORGANUM] Error: 'npm' was not found on PATH.
  echo Install Node.js ^(22+^) and retry.
  pause
  exit /b 1
)

if not exist "%ROOT%\backend\.venv" (
  echo [ORGANUM] Installing backend Python dependencies...
  pushd "%ROOT%\backend"
  call uv sync --all-extras
  if errorlevel 1 (
    popd
    echo [ORGANUM] Backend dependency sync failed.
    pause
    exit /b 1
  )
  popd
)

if not exist "%ROOT%\frontend\node_modules" (
  echo [ORGANUM] Installing frontend Node dependencies...
  pushd "%ROOT%\frontend"
  call npm ci
  if errorlevel 1 (
    popd
    echo [ORGANUM] Frontend dependency install failed.
    pause
    exit /b 1
  )
  popd
)

if not exist "%ROOT%\data\demo_project\00_Pipeline\project.json" (
  echo [ORGANUM] Generating demo project...
  pushd "%ROOT%\backend"
  call uv run python scripts/make_demo_data.py
  if errorlevel 1 (
    popd
    echo [ORGANUM] Demo project generation failed.
    pause
    exit /b 1
  )
  popd
)

echo [ORGANUM] Starting backend and frontend servers...
start "ORGANUM Backend (127.0.0.1:8000)" cmd /k "cd /d ""%ROOT%\backend"" && uv run uvicorn app.main:app --reload --host 127.0.0.1 --port 8000"
start "ORGANUM Frontend (127.0.0.1:5173)" cmd /k "cd /d ""%ROOT%\frontend"" && npm run dev"

echo.
echo   ORGANUM Frontend : http://127.0.0.1:5173
echo   ORGANUM Backend  : http://127.0.0.1:8000/docs
echo.
endlocal
exit /b 0

