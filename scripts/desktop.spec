# PyInstaller input. Only explicitly selected application assets enter the bundle.
from pathlib import Path

root = Path(SPECPATH).parent
analysis = Analysis(
    [str(root / "scripts" / "desktop_entry.py")],
    pathex=[str(root / "backend")],
    binaries=[(str(root / ".cache" / "apple-speech-helper"), ".")],
    datas=[(str(root / "frontend" / "dist"), "app/desktop-assets")],
    hiddenimports=["uvicorn.logging", "uvicorn.loops.auto", "uvicorn.protocols.http.auto",
                   "uvicorn.protocols.websockets.auto", "uvicorn.lifespan.on"],
    excludes=["pytest", "PyInstaller"],
)
archive = PYZ(analysis.pure)
executable = EXE(archive, analysis.scripts, [], exclude_binaries=True,
                 name="caption-relay-service", console=True, contents_directory="_internal")
collection = COLLECT(executable, analysis.binaries, analysis.datas, name="caption-relay-service")
