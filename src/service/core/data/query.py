"""
SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

SPDX-License-Identifier: Apache-2.0
"""

from typing import List
import lark

from src.lib.utils import osmo_errors

# Define a grammar for our query language

# Ignore whitespace
GRAMMAR = (r"""
    %import common.WS
    %ignore WS
""",

# Define constants and operators
r"""
    %import common.NUMBER
    %import common.ESCAPED_STRING -> STRING

    string: STRING
    number: NUMBER
    string_number: string | number
    string_list: "[" string ( "," string )* "]"
    string_number_list: "[" string_number ( "," string_number )* "]"
    boolean: /True|False|true|false|TRUE|FALSE/

    left_paren: "("
    right_paren: ")"
    eq_op: "="
    neq_op: "!="
    less_op: "<"
    greater_op: ">"
    less_eq_op: "<="|"=<"
    greater_eq_op: ">="|"=>"
    and_op: /AND|and/
    or_op: /OR|or/
    in_op: /IN|in/
    not_op: /NOT|not/
    contains_op: /CONTAINS|contains/
    length_op: /LEN|len/
    limit_op: /LIMIT|limit/
    key_op: /KEY|key/
    order_op: /ORDER|order/
    by_op: /BY|by/
    desc_op: /DESC|desc/
    asc_op: /ASC|asc/
    order_type: desc_op | asc_op

    data_string: /[a-zA-Z0-9_-]+/ | "\"" /[a-zA-Z0-9._-]+/ "\""
    data_strings: data_string ("." data_string)*
""",

# Define the different queryable fields
r"""
    name_field: "name"
    id_field: "id"
    created_date_field: "created_date"
    is_collection_field: "is_collection"
    user_field: "user"
    label_only_field: "label"
    metadata_only_field: "metadata"
    label_field: label_only_field "." data_strings
    metadata_field: metadata_only_field "." data_strings

    order_field: name_field | created_date_field | user_field
""",

# Group operators together
r"""
    logical_operator: and_op | or_op
    equal_operator: eq_op | neq_op
    string_operator: in_op
    number_operator: less_op | greater_op | less_eq_op | greater_eq_op
""",

# Define expressions
r"""
    reverse_expression: string equal_operator name_field
                      | string equal_operator id_field
                      | string equal_operator user_field
                      | string equal_operator label_field
                      | string equal_operator metadata_field
                      | string equal_operator created_date_field
                      | boolean equal_operator is_collection_field

    name_expression: name_field equal_operator string
                   | name_field string_operator string_list

    id_expression: id_field equal_operator string
                 | id_field string_operator string_list

    user_expression: user_field equal_operator string
                   | user_field string_operator string_list

    info_string_expression: label_field equal_operator string
                          | label_field string_operator string_list
                          | metadata_field equal_operator string
                          | metadata_field string_operator string_list

    info_number_expression: label_field equal_operator number
                          | label_field number_operator number
                          | metadata_field equal_operator number
                          | metadata_field number_operator number

    info_length_expression: length_op left_paren label_field right_paren equal_operator number
                          | length_op left_paren label_field right_paren number_operator number
                          | length_op left_paren metadata_field right_paren equal_operator number
                          | length_op left_paren metadata_field right_paren number_operator number

    contains_expression: name_field contains_op string
                       | id_field contains_op string
                       | user_field contains_op string
                       | label_field contains_op string
                       | metadata_field contains_op string

    contains_list_expression: label_field contains_op string_number_list
                            | metadata_field contains_op string_number_list

    contains_key_expression: label_only_field contains_op key_op string
                           | metadata_only_field contains_op key_op string
                           | label_field contains_op key_op string
                           | metadata_field contains_op key_op string

    created_date_expression: created_date_field equal_operator string
                           | created_date_field number_operator string

    is_collection_expression: is_collection_field equal_operator boolean

    logical_expression: expression logical_operator expression
    parenthesis_expression: left_paren expression right_paren

    not_expression: not_op expression
""",

# Combine all expressions
r"""
    expression: reverse_expression
              | name_expression
              | id_expression
              | user_expression
              | logical_expression
              | parenthesis_expression
              | info_string_expression
              | info_number_expression
              | info_length_expression
              | contains_expression
              | contains_list_expression
              | created_date_expression
              | is_collection_expression
              | not_expression
              | contains_key_expression
"""

# Create Clause
r"""
    clause: expression
          | expression order_op by_op order_field order_type
          | expression limit_op number
          | expression order_op by_op order_field order_type limit_op number
""")

class QueryTerm:
    """Describes a portion of an SQL query"""
    def __init__(self, cmd: str = '',
                 params: List[str | float] | None = None,
                 metadata_enabled=False):
        self.cmd = cmd
        self.params = params or []
        self.metadata_enabled = metadata_enabled

    def combine(self, other: 'QueryTerm'):
        """Combine two query terms"""
        return QueryTerm(
            f'{self.cmd} {other.cmd}' if self.cmd else other.cmd,
            self.params + other.params,
            self.metadata_enabled or other.metadata_enabled)

    def __add__(self, other):
        """Allows shorthand combining with query1 + query2 + query3 ..."""
        return self.combine(other)


class QueryTransformer(lark.Transformer):
    """Combines the QueryTerms"""
    def __default__(self, data, children, meta):
        """ Define transforms for simple rules """
        # pylint: disable=unused-argument
        # Rules where we can simply replace them with a given token
        replace_rules = {
            'name_field': 'dataset.name',
            'id_field': 'dataset.id',
            'user_field': 'dataset_version.created_by',
            'label_only_field': 'dataset.labels',
            'metadata_only_field': 'dataset_version.metadata',
            'created_date_field': 'dataset.created_date',
            'is_collection_field': 'dataset.is_collection',
            'left_paren': '(',
            'right_paren': ')',
            'and_op': 'AND',
            'or_op': 'OR',
            'eq_op': '=',
            'neq_op': '!=',
            'less_op': '<',
            'greater_op': '>',
            'less_eq_op': '<=',
            'greater_eq_op': '>=',
            'in_op': 'IN',
            'not_op': 'NOT',
            'contains_op': 'LIKE',
            'length_op': 'LEN',
            'limit_op': 'LIMIT',
            'order_op': 'ORDER',
            'by_op': 'BY',
            'key_op': 'KEY',
            'desc_op': 'DESC',
            'asc_op': 'ASC'
        }
        if data in replace_rules:
            return QueryTerm(replace_rules[data])

        # Rules where we may sum the children together, which just concatenates the query
        # expressions together
        sum_rules = {
            'clause',
            'expression',
            'parenthesis_expression',
            'name_expression',
            'id_expression',
            'logical_expression',
            'info_string_expression',
            'equal_operator',
            'string_operator',
            'number_operator',
            'logical_operator',
            'created_date_expression',
            'is_collection_expression',
            'order_field',
            'order_type'
        }
        if data in sum_rules:
            return sum(children, QueryTerm())

        # Raise an exception if a rule has no transform
        raise ValueError(f'No transform found for rule {data}')

    def string(self, children):
        return QueryTerm('%s', [children[0][1:-1]])

    def number(self, children):
        return QueryTerm('%s', [float(children[0])])

    def string_number(self, children):
        return children[0]

    def boolean(self, children):
        return QueryTerm('%s', [children[0][:]])

    def data_string(self, children):
        return QueryTerm('%s', [children[0][:].strip('"')])

    def data_strings(self, children):
        command = '->'.join([child.cmd for child in children])
        params: List = sum((child.params for child in children), [])
        return QueryTerm(command, params)

    def string_list(self, children):
        command = '(' + ','.join(['%s']*len(children)) + ')'
        params: List = sum((child.params for child in children), [])
        return QueryTerm(command, params)

    def string_number_list(self, children):
        command = '\'[' + ','.join(['%s']*len(children)) + ']\''
        params: List = sum((child.params for child in children), [])
        return QueryTerm(command, params)

    def user_expression(self, children):
        command = 'dataset.id in (SELECT id in dataset_version ' +\
                  f'WHERE {" ".join([child.cmd for child in children])})'
        params: List = sum((child.params for child in children), [])
        return QueryTerm(command, params)

    def label_field(self, children):
        command = '->'.join([child.cmd for child in children])
        command = '->>'.join(command.rsplit('->', 1))
        return QueryTerm(command, children[1].params)

    def metadata_field(self, children):
        command = '->'.join([child.cmd for child in children])
        command = '->>'.join(command.rsplit('->', 1))
        return QueryTerm(command, children[1].params, True)

    def reverse_expression(self, children):
        command = ' '.join([child.cmd for child in children[::-1]])
        params: List = children[2].params + children[0].params
        enabled = any(child.metadata_enabled for child in children)
        return QueryTerm(command, params, enabled)

    def info_number_expression(self, children):
        command = children[0].cmd
        children[0].cmd = f'jsonb_typeof({command.replace("->>", "->")}) = \'number\' AND ' +\
                          f'({command})::float'
        command = f'({" ".join([child.cmd for child in children])})'
        children[0].params += children[0].params
        params: List = sum((child.params for child in children), [])
        enabled = any(child.metadata_enabled for child in children)
        return QueryTerm(command, params, enabled)

    def info_length_expression(self, children):
        command = children[2].cmd.replace('->>', '->')
        children[2].cmd = f'jsonb_typeof({command}) = \'array\' AND ' +\
                          f'jsonb_array_length({command})'
        command = f'({children[2].cmd} {" ".join([child.cmd for child in children[4:]])})'
        children[2].params += children[2].params
        params: List = sum((child.params for child in children), [])
        enabled = any(child.metadata_enabled for child in children)
        return QueryTerm(command, params, enabled)

    def contains_expression(self, children):
        value = children[-1].params[0]
        value = value.replace('_', r'\_').replace('%', r'\%')
        children[-1].params[0] = f'%{value}%'
        command = ' '.join([child.cmd for child in children])
        params: List = sum((child.params for child in children), [])
        enabled = any(child.metadata_enabled for child in children)
        return QueryTerm(command, params, enabled)

    def not_expression(self, children):
        command = f'{children[0].cmd} ({" ".join([child.cmd for child in children[1:]])})'
        params: List = sum((child.params for child in children), [])
        enabled = any(child.metadata_enabled for child in children)
        return QueryTerm(command, params, enabled)

    def contains_list_expression(self, children):
        info_term = children[0].cmd.replace('->>', '->')
        command = f'{info_term} @> {children[2].cmd}'
        params: List = sum((child.params for child in children), [])
        enabled = any(child.metadata_enabled for child in children)
        return QueryTerm(command, params, enabled)

    def contains_key_expression(self, children):
        command = f'{children[0].cmd} ? {children[3].cmd}'
        params: List = sum((child.params for child in children), [])
        enabled = any(child.metadata_enabled for child in children)
        return QueryTerm(command, params, enabled)


class QueryParser():
    """ Class to parse dataset queryies """
    _instance = None

    @staticmethod
    def get_instance():
        """ Static access method. """
        if not QueryParser._instance:
            return QueryParser()
        return QueryParser._instance

    def __init__(self):
        if QueryParser._instance:
            raise osmo_errors.OSMOError(
                'Only one instance of Query Parser can exist!')
        QueryParser._instance = self
        self.parser = lark.Lark(''.join(GRAMMAR),
                                start='clause',
                                parser='lalr')
        # For some reason, having transformer=QueryTransformer() in parser creates errors
        self.transformer = QueryTransformer()

    def parse(self, expression: str):
        try:
            result = self.transformer.transform(self.parser.parse(expression))
        except lark.LarkError as err:
            raise osmo_errors.OSMOUserError(f'Parsing error: {err}')
        return result
