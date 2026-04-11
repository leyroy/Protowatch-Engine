// Minimal react-native mock for Jest tests

const PermissionsAndroid = {
  PERMISSIONS: {
    READ_PHONE_STATE: 'android.permission.READ_PHONE_STATE',
    ACCESS_FINE_LOCATION: 'android.permission.ACCESS_FINE_LOCATION',
  },
  RESULTS: {
    GRANTED: 'granted',
    DENIED: 'denied',
    NEVER_ASK_AGAIN: 'never_ask_again',
  },
  requestMultiple: jest.fn().mockResolvedValue({
    'android.permission.READ_PHONE_STATE': 'granted',
    'android.permission.ACCESS_FINE_LOCATION': 'granted',
  }),
  check: jest.fn().mockResolvedValue(true),
};

const Platform = {
  OS: 'android',
};

const NativeModules = {};

const NativeEventEmitter = jest.fn().mockImplementation(() => ({
  addListener: jest.fn().mockReturnValue({ remove: jest.fn() }),
  removeAllListeners: jest.fn(),
}));

module.exports = { PermissionsAndroid, Platform, NativeModules, NativeEventEmitter };
