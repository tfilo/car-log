export const LogOperation = {
    REGISTRATION_VERIFICATION: 'registrationVerification',
    DELIVER_ACCOUNT_EMAIL: 'deliverAccountEmail',
    VEHICLE_PICTURE_REQUEST: 'vehiclePictureRequest',
    READ_VEHICLE_PICTURE: 'readVehiclePicture',
    DELETE_PICTURE_FILE: 'deletePictureFile',
    CLEANUP_PICTURES: 'cleanupPictures'
} as const;

export type LogOperation = (typeof LogOperation)[keyof typeof LogOperation];
