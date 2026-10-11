// electron-builder hook: writes the Bryt Shell icon and version info INTO the app's .exe.
// Why: electron-builder's own step for this downloads a signing toolkit that fails on many
// Windows PCs ("Cannot create symbolic link"), and without it the exe keeps Electron's atom icon.
// This uses the pure-JS "resedit" library instead, so no toolkit, no admin rights, no Developer Mode.
const fs = require('fs');
const path = require('path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const PE = await import('pe-library');
  const RE = await import('resedit');

  const info = context.packager.appInfo;
  const exePath = path.join(context.appOutDir, info.productFilename + '.exe');
  const iconPath = path.join(context.packager.projectDir, 'build', 'icon.ico');

  const exe = PE.NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
  const res = PE.NtExecutableResource.from(exe);

  // 1) icon: replace every icon group the Electron exe ships with
  const icons = RE.Data.IconFile.from(fs.readFileSync(iconPath)).icons.map((i) => i.data);
  const groups = RE.Resource.IconGroupEntry.fromEntries(res.entries);
  if (!groups.length) throw new Error('afterPack: no icon group found in ' + exePath);
  for (const g of groups) RE.Resource.IconGroupEntry.replaceIconsForResource(res.entries, g.id, g.lang, icons);

  // 2) version info shown in Task Manager / file properties
  const vi = RE.Resource.VersionInfo.fromEntries(res.entries)[0];
  if (vi) {
    const [a, b, c] = String(info.version).split('.').map((n) => parseInt(n, 10) || 0);
    vi.setFileVersion(a, b, c, 0, 1033);
    vi.setProductVersion(a, b, c, 0, 1033);
    vi.setStringValues({ lang: 1033, codepage: 1200 }, {
      ProductName: 'Bryt Shell',
      FileDescription: 'Bryt Shell',
      InternalName: 'Bryt Shell',
      OriginalFilename: info.productFilename + '.exe',
      CompanyName: 'BrytMa Tech Uganda',
      LegalCopyright: 'Built in Uganda by BrytMa Tech Uganda'
    });
    vi.outputToResourceEntries(res.entries);
  }

  res.outputResource(exe);
  fs.writeFileSync(exePath, Buffer.from(exe.generate()));
  console.log('  • afterPack: icon and version info written to ' + path.basename(exePath));
};
