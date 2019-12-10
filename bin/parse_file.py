# -*- coding: utf-8 -*-

'''Parse Python File
'''

from __future__ import print_function

import ast
import json
import os, sys
import tokenize
from io import BytesIO
from io import StringIO
from collections import defaultdict
import codecs

import sys
info = sys.version_info

class PythonFileParser(object):
    '''Python文件解析器
    '''
    
    def __init__(self, file_path):
        self._file_path = file_path
        self._imports = {}
        with codecs.open(self._file_path, "r", encoding='utf-8') as f:
            code = f.read()
            enc = f.encoding
        if(info[0] == 2):
            self.rl = BytesIO(code.encode(enc)).readline
        else:
            self.rl = StringIO(code).readline
        self.tokens = list(tokenize.generate_tokens(self.rl))
        # print(self.tokens)

        self.token_table = defaultdict(list)  # mapping line numbers to token numbers
        for i, tok in enumerate(self.tokens):
            # print(i, tok)
            # self.token_table[tok.start[0]].append(i)
            self.token_table[tok[2][0]].append(i)

        # print(self.token_table)

    def find_control_endline(self, start):
        i = self.token_table[start][0]  # last token number on the start line
        while self.tokens[i][1] != '}' or self.tokens[i][0] != tokenize.OP:
            i += 1
        return self.tokens[i][2][0]

    
    
    def _get_doc_string(self, item):
        '''
        '''
        doc_string = ast.get_docstring(item)
        if doc_string: return doc_string.strip().split('\n')[0].strip()
        return ''
        
    def parse_locator_dict(self, locator_dict):
        '''
        '''
        controls = []
        for i, key in enumerate(locator_dict.keys):
            if not isinstance(key, ast.Str): continue
            # print(key.s)
            # print(key.lineno)
            control = {}
            control['name'] = key.s
            control['line'] = key.lineno
            control['endline'] = self.find_control_endline(key.lineno)
            control['attrs'] = {}
            #print args[0].values[i]
            if not isinstance(locator_dict.values[i], ast.Dict): continue
            value = locator_dict.values[i]
            for j, attr in enumerate(value.keys):
                if not isinstance(attr, ast.Str):
                    continue
                #print value.values[j], attr.s if hasattr(attr, 's') else attr.id
                if isinstance(value.values[j], ast.Call):
                    # 主要是locator字段
                    if len(value.values[j].args) != 1 or not isinstance(value.values[j].args[0], ast.Str):
                        # 暂不支持这种情况
                        continue
                    control['attrs'][attr.s] = [value.values[j].func.id, value.values[j].args[0].s]
                elif isinstance(value.values[j], ast.Name):
                    val = value.values[j].id
                    if val == 'self':
                        # 只有root字段会用
                        control['attrs'][attr.s] = None
                    else:
                        if val in self._imports:
                            control['attrs'][attr.s] = [self._imports[val], val]
                        else:
                            # Current module
                            control['attrs'][attr.s] = [None, val]
                elif isinstance(value.values[j], ast.Attribute):
                    val = value.values[j].attr
                    if val == 'self':
                        # 只有root字段会用
                        control['attrs'][attr.s] = None
                    else:
                        if val in self._imports:
                            control['attrs'][attr.s] = [self._imports[val], val]
                        else:
                            # Current module
                            control['attrs'][attr.s] = [None, val]
                            
                elif hasattr(value.values[j], 's'):
                    control['attrs'][attr.s] =  value.values[j].s
                elif hasattr(value.values[j], 'n'):
                    control['attrs'][attr.s] =  value.values[j].n
                else:
                    pass
                    #raise NotImplementedError(value.values[j])
            controls.append(control)
        return controls

    def check_class_istestcase(self, clazz):
        is_testcase = True
        func_list = list(map(lambda func: func['name'], clazz['functions']))
        if 'run_test' not in func_list and 'runTest' not in func_list:
            is_testcase = False
        static_field_list = list(map(lambda static_field: static_field[0], clazz['static_fields']))
        is_testcase &= 'owner' in static_field_list
        is_testcase &= 'timeout' in static_field_list
        is_testcase &= 'priority' in static_field_list
        is_testcase &= 'status' in static_field_list
        return is_testcase
        
    def parse_class(self, class_node):
        '''解析类
        '''
        clazz = {}
        clazz['name'] = class_node.name
        clazz['docstring'] = self._get_doc_string(class_node)
        clazz['line'] = class_node.lineno
        clazz['endline'] = self.get_end_lineno(class_node)
        clazz['is_testcase'] = False
        clazz['bases'] = []
        clazz['controls'] = []
        for base in class_node.bases:
            if isinstance(base, ast.Attribute):
                clazz['bases'].append([self._imports[base.value.id], base.attr])
            else:
                clazz['bases'].append([None, base.id])
        clazz['static_fields'] = []
        clazz['functions'] = []
        for item in class_node.body:
            if isinstance(item, ast.Assign) and len(item.targets) == 1:
                if isinstance(item.targets[0], ast.Name) and (item.targets[0].id in ['owner', 'timeout', 'status', 'priority']):
                    if isinstance(item.value, ast.Str):
                        clazz['static_fields'].append((item.targets[0].id, item.value.s, item.lineno))
                    elif isinstance(item.value, ast.Num):
                        clazz['static_fields'].append((item.targets[0].id, str(item.value.n), item.lineno))
                    elif isinstance(item.value, ast.Attribute):
                        clazz['static_fields'].append((item.targets[0].id, item.value.attr, item.lineno))
                    # clazz['static_fields'].append((item.targets[0].id, item.value.s, item.lineno))
                elif isinstance(item.targets[0], ast.Name) and isinstance(item.value, ast.Str):
                    clazz['static_fields'].append((item.targets[0].id, item.value.s, item.lineno))
            elif isinstance(item, ast.FunctionDef):
                if item.name == '__init__':
                    # 获取控件定义
                    locator = None
                    for it in item.body:
                        if isinstance(it, ast.Expr) and isinstance(it.value, ast.Call): 
                            if it.value.func.attr == 'updateLocator' or it.value.func.attr == 'update_locator':
                                args = it.value.args
                                if len(args) == 0: continue
                                if isinstance(args[0], ast.Dict):
                                    locator = args[0]
                                    
                                else:
                                    locator = args[0]
                                    for variable in item.body:
                                        if(isinstance(variable, ast.Assign)):
                                            for j in variable.targets:
                                                if(isinstance(j, type(locator))):
                                                    if(isinstance(j, ast.Name)):
                                                        if(j.id == locator.id):
                                                            locator = variable.value
                                                    elif(isinstance(j, ast.Attribute)):
                                                        if(j.attr == locator.attr):
                                                            locator = variable.value
                                if not isinstance(locator, ast.Dict): continue
                                clazz['controls'] += self.parse_locator_dict(locator)
                func = {}
                func['name'] = item.name
                func['docstring'] = self._get_doc_string(item)
                func['line'] = item.lineno
                func['endline'] = self.get_end_lineno(item)
                func['steps'] = []
                if item.name == 'run_test' or item.name == 'runTest':
                    for it in item.body:
                        if isinstance(it, ast.Expr) and isinstance(it.value, ast.Call):
                            if isinstance(it.value.func, ast.Attribute) and (it.value.func.attr == 'start_step' or it.value.func.attr == 'startStep'):
                                step = {}
                                step['name'] = it.value.args[0].s
                                step['docstring'] = it.value.args[0].s
                                step['line'] = it.lineno
                                step['endline'] = self.get_end_lineno(it)
                                func['steps'].append(step)
                clazz['functions'].append(func)
        clazz['functions'].sort(key=lambda x: x['name']) # sort by function name
        clazz['is_testcase'] = self.check_class_istestcase(clazz)

        return clazz
    
    def parse(self):
        '''解析Python文件
        '''
        if not os.path.exists(self._file_path):
            raise RuntimeError('File %s not exist' % self._file_path)
        result = {}
        result['classes'] = []
        result['functions'] = []
        result['errors'] = []
        
        with open(self._file_path, 'rb') as fp:
            text = fp.read()
            try:
                root_node = ast.parse(text)
            except SyntaxError as e:
                result['errors'].append({'lineno': e.lineno, 'text': e.text})
                return result
                
            result['docstring'] = self._get_doc_string(root_node)
            for top_item in root_node.body:
                #print top_item
                if isinstance(top_item, ast.Import):
                    for item in top_item.names:
                        if isinstance(item, ast.alias):
                            self._imports[item.asname if item.asname else item.name] = item.name
                        else:
                            raise NotImplementedError(item)
                elif isinstance(top_item, ast.ImportFrom):
                    # print(top_item.module, top_item.__dict__)
                    for item in top_item.names:
                        if isinstance(item, ast.alias):
                            self._imports[item.asname if item.asname else item.name] = top_item.module
                        else:
                            raise NotImplementedError(item)
                            
                elif isinstance(top_item, ast.ClassDef):
                    clazz = self.parse_class(top_item)
                    result['classes'].append(clazz)
                elif isinstance(top_item, ast.FunctionDef):
                    func = {}
                    func['name'] = top_item.name
                    func['docstring'] = self._get_doc_string(top_item)
                    func['line'] = top_item.lineno
                    func['endline'] = self.get_end_lineno(top_item)
                    result['functions'].append(func)
        result['classes'].sort(key=lambda x: x['name']) # sort by class name
        result['functions'].sort(key=lambda x: x['name']) # sort by function name
        return result
        
    def get_end_lineno(self, node):
        if not hasattr(node, 'body') or len(node.body) == 0:
            return node.lineno
        return self.get_end_lineno(node.body[-1])

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('usage: python parse_file.py python_file_path', file=sys.stderr)
        exit(-1)
    result = PythonFileParser(sys.argv[1]).parse()
    print(json.dumps(result))
    exit(0)