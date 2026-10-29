import React, { useState } from 'react';
import { getAppIcon } from '../utils/appIcons';

interface AppLogoProps {
  packageName: string;
  appName: string;
  size?: number;
  className?: string;
}

export const AppLogo: React.FC<AppLogoProps> = ({
  packageName,
  appName,
  size = 32,
  className = '',
}) => {
  const [loadFailed, setLoadFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // If already marked as fallback or generic internal system service, render fallback directly
  const isSystemInternal =
    packageName.startsWith('android') ||
    packageName.startsWith('com.android.systemui') ||
    packageName.startsWith('com.android.providers') ||
    packageName.startsWith('com.google.android.overlay');

  if (loadFailed || isSystemInternal) {
    return <>{getAppIcon(packageName, appName, size)}</>;
  }

  const onlineLogoUrl = `/api/logos/icon?package=${encodeURIComponent(packageName)}&name=${encodeURIComponent(appName)}`;

  return (
    <div
      style={{ width: size, height: size }}
      className={`relative flex items-center justify-center rounded-lg overflow-hidden bg-slate-800 shadow-sm flex-shrink-0 ${className}`}
    >
      {/* Fallback underneath until image loads */}
      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center">
          {getAppIcon(packageName, appName, size)}
        </div>
      )}

      {/* Online Discovered App Logo */}
      <img
        src={onlineLogoUrl}
        alt={appName}
        loading="lazy"
        onLoad={() => setLoaded(true)}
        onError={() => setLoadFailed(true)}
        style={{ width: size, height: size }}
        className={`w-full h-full object-cover transition-opacity duration-300 rounded-lg ${
          loaded ? 'opacity-100 z-10' : 'opacity-0'
        }`}
      />
    </div>
  );
};

