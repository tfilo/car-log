export const EmailDeliveryStatus = {
    SENT: 'sent',
    UNAVAILABLE: 'unavailable'
} as const;

export type EmailDeliveryStatus = (typeof EmailDeliveryStatus)[keyof typeof EmailDeliveryStatus];
