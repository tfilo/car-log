import { createInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';

import auth from './locales/sk/auth.json' with { type: 'json' };
import vehicles from './locales/sk/vehicles.json' with { type: 'json' };
import fuel from './locales/sk/fuel.json' with { type: 'json' };
import expenses from './locales/sk/expenses.json' with { type: 'json' };
import statistics from './locales/sk/statistics.json' with { type: 'json' };

export const i18n = createInstance();

void i18n.use(initReactI18next).init({
    lng: 'sk',
    fallbackLng: 'sk',
    defaultNS: 'auth',
    resources: { sk: { auth, vehicles, fuel, expenses, statistics } },
    initAsync: false,
    interpolation: { escapeValue: false }
});
