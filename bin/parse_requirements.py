# -*- coding: utf-8 -*-

'''Parse requirements File
'''

from __future__ import print_function

import json
import sys
info = sys.version_info

try: # for pip >= 10
    from pip._internal.req import parse_requirements
    from pip._internal import download
except ImportError: # for pip <= 9.0.3
    from pip.req import parse_requirements
    from pip import download

import pip
import pkg_resources
from pkg_resources import DistributionNotFound, VersionConflict

def check_dependencies(requirement_file_name):
    """
    Checks to see if the python dependencies are fullfilled.
    If check passes return 0. Otherwise print error and return 1
    """
    check_result = {}
    dependencies = []
    session = download.PipSession()
    for req in parse_requirements(requirement_file_name, session=session):
        if req.markers is not None:
            extras_requested = ('',)
            if not any(req.markers.evaluate({'extra': extra}) for extra in extras_requested):
                continue
        if req.req is not None:
            dependencies.append(str(req.req))
        else:
            pass
    try:
        pkg_resources.working_set.require(dependencies)
    except VersionConflict as e:
        try:
            check_result['result'] = False
            check_result['error'] = "{} was found on your system, but {} is required.".format(e.dist, e.req)
            return check_result
        except AttributeError:
            check_result['result'] = False
            check_result['error'] = str(e)
            return check_result
    except DistributionNotFound as e:
        check_result['result'] = False
        check_result['error'] = str(e)
        return check_result
    check_result['result'] = True
    return check_result

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('usage: python parse_requirements.py requirements_file_path', file=sys.stderr)
        exit(-1)
    print(json.dumps(check_dependencies(sys.argv[1])))
    exit(0)