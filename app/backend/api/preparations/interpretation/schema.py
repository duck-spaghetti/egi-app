"""Build closed provider output schemas from the pinned Reviewer's frozen dictionary.

Optional facts are represented as nullable required properties for Structured
Outputs; clean_result removes only those absent proposal/diagnostic values before
the independent Reviewer validates actual facts and exact evidence.
"""
from copy import deepcopy

from review.insertion import DIAGNOSTICS
from review.insertion_fields import dictionary


def object_schema(properties: dict) -> dict:
    """Require precisely the declared properties, as strict Structured Outputs needs."""
    return {'type': 'object', 'properties': properties, 'required': list(properties), 'additionalProperties': False}


def nullable(value: dict) -> dict:
    """Represent one unknown optional fact without inventing a value."""
    return {'anyOf': [value, {'type': 'null'}]}


def array_schema(item: dict) -> dict:
    """Represent a bounded locally validated collection of typed values."""
    return {'type': 'array', 'items': item}


def output_schema(request: dict) -> dict:
    """Describe only proposed facts, excluding canonical IDs and publish permissions."""
    fields = dictionary()

    def component(members: dict) -> dict:
        """Recursively describe fields allowed by the reusable interpretation module."""
        properties = {}
        for key, descriptor in members.items():
            if descriptor in ('reference', 'permission', 'references'):
                continue
            if descriptor.endswith('[]'):
                value = array_schema(component(fields['components'][descriptor[:-2]]))
            elif descriptor in fields['components']:
                value = component(fields['components'][descriptor])
            else:
                value = {'type': {'int': 'integer', 'number': 'number'}.get(descriptor, 'string')}
                if key in fields['enums']:
                    value['enum'] = fields['enums'][key]
            properties[key] = nullable(value)
        return object_schema(properties)

    diagnostic = object_schema({'code': {'type':'string', 'enum': sorted(DIAGNOSTICS)},
        'path': nullable({'type':'string'}), 'candidate_key': nullable({'type':'string'})})
    evidence = object_schema({'id': {'type':'string'}, 'path': {'type':'string'},
        'input_id': {'type':'string', 'enum':[request['input_id']]},
        'input_hash': {'type':'string', 'enum':[request['input_hash']]},
        'kind': {'type':'string', 'enum':['stated','interpreted']},
        'span': object_schema({'start':{'type':'integer'}, 'end':{'type':'integer'}}),
        'quote': {'type':'string'}})
    location = {'anyOf': [object_schema({'kind': {'type':'string','enum':['none']}}),
        object_schema({'kind':{'type':'string','enum':['new']},'body':component(fields['location'])})]}
    candidate = object_schema({'candidate_key':{'type':'string'}, 'service':component(fields['service']),
        'location':location, 'evidence':array_schema(evidence), 'diagnostics':array_schema(diagnostic)})
    return object_schema({'schema_version': {'type':'integer','enum':[1]},
        'input_id': {'type':'string','enum':[request['input_id']]},
        'input_hash': {'type':'string','enum':[request['input_hash']]},
        'config_version': {'type':'string','enum':[request['config_version']]},
        'state':{'type':'string','enum':['complete','incomplete','refused']},
        'candidates':array_schema(candidate),'mapping':{'type':'null'},'diagnostics':array_schema(diagnostic)})


def clean_result(value: dict) -> dict:
    """Remove only declared nullable facts; preserve unknown keys for rejection."""
    result = deepcopy(value)
    fields = dictionary()

    def component(node, members):
        """Clean known nullable properties without repairing invalid structures."""
        if not isinstance(node, dict):
            return node
        cleaned = {}
        for key, child in node.items():
            descriptor = members.get(key)
            if descriptor is None or descriptor in ('reference','references','permission'):
                cleaned[key] = child
            elif child is None:
                continue
            elif descriptor.endswith('[]') and isinstance(child,list):
                cleaned[key] = [component(item,fields['components'][descriptor[:-2]]) for item in child]
            elif descriptor in fields['components']:
                cleaned[key] = component(child,fields['components'][descriptor])
            else:
                cleaned[key] = child
        return cleaned

    def diagnostics(items):
        """Drop only optional null diagnostic identifiers, retaining invalid extras."""
        if not isinstance(items,list):
            return items
        return [{key:child for key,child in item.items() if child is not None or key not in ('path','candidate_key')}
                if isinstance(item,dict) else item for item in items]
    if not isinstance(result,dict):
        return result
    if isinstance(result.get('candidates'),list):
        for candidate in result['candidates']:
            if not isinstance(candidate,dict):
                continue
            if 'service' in candidate:
                candidate['service'] = component(candidate['service'],fields['service'])
            location = candidate.get('location')
            if isinstance(location,dict) and location.get('kind') == 'new' and 'body' in location:
                location['body'] = component(location['body'],fields['location'])
            if 'diagnostics' in candidate:
                candidate['diagnostics'] = diagnostics(candidate['diagnostics'])
    if 'diagnostics' in result:
        result['diagnostics'] = diagnostics(result['diagnostics'])
    return result
