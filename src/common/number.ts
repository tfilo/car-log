function shiftDecimal(value: number, places: number): number {
    const [coefficient, exponent = '0'] = value.toString().split('e');

    return Number(`${coefficient}e${Number(exponent) + places}`);
}

export function roundNumber(value: number, places = 2): number {
    return shiftDecimal(Math.round(shiftDecimal(value, places)), -places);
}

export function displayNumber(value: number, minimumDecimals = 0, maximumDecimals = 2): string {
    return new Intl.NumberFormat('sk-SK', {
        minimumFractionDigits: minimumDecimals,
        maximumFractionDigits: maximumDecimals
    }).format(roundNumber(value, maximumDecimals));
}
