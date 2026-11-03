// Move existing nodes once: the same sensor instances, IDs and listeners survive.
if (window.parent !== window) {
  const capture = document.querySelector('.capture-layout');
  const settings = capture.querySelector('.settings');
  const imu = document.querySelector('.imu-section');
  const side = document.createElement('div');
  side.className = 'capture-side';
  const settingsDetails = document.createElement('details');
  settingsDetails.className = 'capture-settings';
  const settingsSummary = document.createElement('summary');
  settingsSummary.textContent = '采集设置与手动记录';
  settingsDetails.append(settingsSummary);
  capture.append(side);
  side.append(imu, settingsDetails);
  settingsDetails.append(settings);

  const sourceActions = document.createElement('div');
  sourceActions.className = 'source-actions';
  sourceActions.append(document.getElementById('cameraButton'), document.getElementById('stopSource'));
  document.querySelector('.viewer-top').append(sourceActions);
  settings.prepend(document.getElementById('sourceName'));

  const config = imu.querySelector('.imu-config');
  const calibration = config.querySelector('.calibration-row');
  const extras = [...config.children].filter(node => node !== calibration);
  const advanced = document.createElement('details');
  advanced.className = 'imu-advanced';
  const advancedSummary = document.createElement('summary');
  advancedSummary.textContent = '检测设置与手动记录';
  advanced.append(advancedSummary, ...extras);
  config.append(advanced);
  const note = imu.querySelector('.imu-reading small');
  if (note) imu.querySelector('.device-details').append(note);
}
