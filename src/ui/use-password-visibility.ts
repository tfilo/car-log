import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EyeIcon, EyeSlashIcon } from '@heroicons/react/16/solid';

export function usePasswordVisibility() {
    const { t } = useTranslation('auth');

    const [visible, setVisible] = useState(false);

    const type: 'password' | 'text' = visible ? 'text' : 'password';

    return {
        type,
        endAction: {
            icon: visible ? EyeSlashIcon : EyeIcon,
            title: t(visible ? 'passwordVisibility.hide' : 'passwordVisibility.show'),
            onClick: () => setVisible((current) => !current)
        }
    };
}
