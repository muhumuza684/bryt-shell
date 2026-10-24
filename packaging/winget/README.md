# winget package for Bryt Shell

Goal: `winget install BrytMaTech.BrytShell`.

1. Publish the GitHub release for the version (the installer must be attached as `Bryt-Shell-Setup.exe`).
2. In PowerShell, in this folder: `.\make-manifest.ps1 -Version 2.10.0`
3. Check the result: `winget validate --manifest .\manifests\2.10.0`
4. Test it on your own PC: `winget install --manifest .\manifests\2.10.0` (you may first need `winget settings --enable LocalManifestFiles`).
5. Submit it: fork https://github.com/microsoft/winget-pkgs, copy the three files into `manifests\b\BrytMaTech\BrytShell\2.10.0\`, and open a pull request. Microsoft's bots check the installer automatically; the first approval takes a few days, later versions are quicker (the script makes the files for every new version).

Note: the installer is not code-signed, so Windows shows its usual SmartScreen notice (see the README). winget accepts unsigned installers.
