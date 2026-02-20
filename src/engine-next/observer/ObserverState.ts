export interface ObserverGeo {
  latitudeRad: number;
  longitudeRad: number;
  elevationMeters: number;
}

export interface ObserverTime {
  ttMjd: number;
  utcMjd: number;
}

export interface ObserverState {
  geo: ObserverGeo;
  time: ObserverTime;
}

export function createObserverState(): ObserverState {
  return {
    geo: {
      latitudeRad: 25.066667 * Math.PI / 180,
      longitudeRad: 121.516667 * Math.PI / 180,
      elevationMeters: 0,
    },
    time: {
      ttMjd: 0,
      utcMjd: 0,
    },
  };
}
