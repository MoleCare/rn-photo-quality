jest.mock('react-native', () => ({
  Platform: {OS: 'ios', Version: '17.2'},
}));

jest.mock('react-native-device-info', () => ({
  __esModule: true,
  default: {
    getModel: jest.fn(() => 'TestDevice'),
    getVersion: jest.fn(() => '0.0.0'),
    getBuildNumber: jest.fn(() => '1'),
    isEmulatorSync: jest.fn(() => false),
  },
}));

jest.mock('@react-native-community/image-editor', () => ({
  cropImage: jest.fn(),
}));

jest.mock('react-native-fs', () => ({
  CachesDirectoryPath: '/tmp',
  writeFile: jest.fn(),
  readFile: jest.fn(),
  unlink: jest.fn(() => Promise.resolve()),
}));

jest.mock('jpeg-js', () => ({
  decode: jest.fn(),
}));
