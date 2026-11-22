export const GAP = 12;
export const TABLET_RATIO = 1440 / 2200;

export function columnRegions(area) {
    const width = Math.floor((area.width - GAP) / 2);
    return [
        {x: area.x, y: area.y, width, height: area.height},
        {x: area.x + width + GAP, y: area.y,
            width: area.width - width - GAP, height: area.height},
    ];
}

// Internal gutters belong to the nearest region, so they cannot fall through
// to Mutter's competing native edge target. Outside the work area stays free.
export function layoutTarget(regions, area, x, y) {
    if (x < area.x || y < area.y || x >= area.x + area.width || y >= area.y + area.height)
        return -1;
    let nearest = -1, distance = Infinity;
    regions.forEach((r, index) => {
        const dx = Math.max(r.x - x, 0, x - (r.x + r.width));
        const dy = Math.max(r.y - y, 0, y - (r.y + r.height));
        if (dx * dx + dy * dy < distance) {
            nearest = index;
            distance = dx * dx + dy * dy;
        }
    });
    return nearest;
}

export function layoutRegions(area, decoration = 36) {
    const topHeight = Math.floor((area.height - GAP) / 2);
    const bottomHeight = area.height - GAP - topHeight;
    const leftWidth = Math.floor((area.width - GAP) / 2);
    const tabletWidth = Math.min(area.width - GAP - 100,
        Math.round(Math.max(1, bottomHeight - decoration) * TABLET_RATIO));
    const bottomY = area.y + topHeight + GAP;
    return [
        {x: area.x, y: area.y, width: leftWidth, height: topHeight},
        {x: area.x + leftWidth + GAP, y: area.y,
            width: area.width - leftWidth - GAP, height: topHeight},
        {x: area.x, y: bottomY, width: tabletWidth, height: bottomHeight},
        {x: area.x + tabletWidth + GAP, y: bottomY,
            width: area.width - tabletWidth - GAP, height: bottomHeight},
    ];
}

export function regionAt(regions, x, y) {
    return regions.findIndex(r => x >= r.x && y >= r.y &&
        x < r.x + r.width && y < r.y + r.height);
}
