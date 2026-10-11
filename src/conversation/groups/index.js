import { randomUUID } from 'node:crypto';
import { invariant } from '../../../public/shared/conversation/schemas/index.js';

export function createGroupScheduler({ id = randomUUID } = {}) {
    return {
        select(snapshot, request = {}) {
            const group = snapshot.resources.find(resource => resource.id === snapshot.settings.groupId && resource.kind === 'group');
            invariant(group, 'group-required', 'Select a new group resource', 422);
            const allowed = group.data.members ?? [];
            invariant(Array.isArray(allowed) && allowed.length > 0 && allowed.length <= 32, 'invalid-group', 'Group requires 1–32 members');
            let selected = [...allowed];
            if (request.members) {
                invariant(Array.isArray(request.members) && request.members.length > 0 && request.members.every(member => allowed.includes(member)), 'invalid-member', 'Requested members must belong to the group');
                selected = request.members;
            } else if (group.data.mode === 'round-robin') {
                selected = [allowed[(snapshot.messages.filter(message => message.role === 'assistant' && message.status === 'completed').length) % allowed.length]];
            } else if (group.data.mode === 'natural') {
                const content = request.content?.toLocaleLowerCase() ?? '';
                const mentioned = allowed.filter(member => {
                    const resource = snapshot.resources.find(item => item.id === member);
                    return resource && content.includes(resource.name.toLocaleLowerCase());
                });
                selected = mentioned.length ? mentioned : allowed.slice(0, 1);
            }
            invariant(new Set(selected).size === selected.length, 'invalid-group', 'Members may not repeat in one group turn');
            return selected.map(characterId => {
                invariant(snapshot.resources.some(resource => resource.kind === 'character' && resource.id === characterId), 'missing-member', 'Group character is missing', 422);
                return { id: id(), characterId };
            });
        },
        snapshot(snapshot, member) {
            return { ...snapshot, settings: { ...snapshot.settings, characterId: member.characterId }, resources: snapshot.resources.filter(resource => resource.kind !== 'character' || resource.id === member.characterId) };
        },
    };
}
