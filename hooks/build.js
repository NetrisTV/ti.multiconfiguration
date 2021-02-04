/**
 * Titanium CLI version/
 */
exports.cliVersion = '>=3.X';

var PROJECT_DIR;
var RESOURCES_DIR;
var configFile;
var buildConfig;

var path = require('path');
var fs = require('fs');

function isArray(obj) {
  return Object.prototype.toString.call(obj) === '[object Array]';
}

function extendArray(to, from, prefix) {
  from.forEach(function(item, idx) {
    if (to.indexOf(item) !== -1) {
      return;
    }
    var copy;
    if (typeof item === 'object') {
      copy = {};
      extendObject(copy, item, prefix + '[' + idx + ']')
    } else {
      copy = item;
    }
    to.push(copy);
  })
}

function extendObject(to, from, prefix)  {
  Object.keys(from).forEach(function(key) {
    var newPrefix = prefix + '.' + key;
    var type = typeof to[key];
    if (isArray(from[key])) {
      if (type === 'undefined') {
        to[key] = [];
      } else if (!isArray(to[key])) {
        throw TypeError('Wrong type "' + type + '" of ' + newPrefix);
      }
      return extendArray(to[key], from[key], newPrefix);
    }
    if (typeof from[key] === 'object') {
      if (type === 'undefined') {
        to[key] = {};
      } else if (type !== 'object') {
        throw TypeError('Wrong type "' + type + '" of ' + newPrefix);
      }
      return extendObject(to[key], from[key], newPrefix);
    }
    to[key] = from[key];
  })
}

/**
 * @param {Object} logger Logger.
 * @param {Object} config Configuration object.
 * @param {Object} cli Titanium CLI instance.
 * @param {Object} appc Titanium appc library instance.
 */
exports.init = function(logger, config, cli, appc) {
  var isShadow = false;

  if (cli.argv['project-dir'].indexOf('appify') > 0) {
    isShadow = true;
  }

  // TiShadow uses it's own project directory.
  PROJECT_DIR = isShadow ? path.join(cli.argv['project-dir'], '../../') :
    cli.argv['project-dir'];

  var DESTROOT = cli.argv['project-dir'];

  RESOURCES_DIR = path.join(DESTROOT, 'Resources');
  configFile = cli.argv['build-config'] ||
    path.join(PROJECT_DIR, 'config.json');
  try {
    fs.statSync(configFile);
  } catch (e) {
    logger.error('Unable to read Multiconfiguration file ' + configFile);
    process.exit(1);
  }

  try {
    buildConfig = JSON.parse(fs.readFileSync(configFile));
  } catch (e) {
    logger.error('Unable to parse Multiconfiguration file ' + configFile);
    logger.error(e);
    process.exit(1);
  }

  if (!buildConfig || !buildConfig.PROFILES) {
    logger.error('Invalid config.json');
    process.exit(1);
  }


  if (cli.argv['$command'] === 'build') {
    var p = cli.argv['build-profile'] || 'default';
    var profile = buildConfig.PROFILES[p];
    if (!profile) {
      logger.error('Invalid profile ' + p);
      logger.error('Available profiles: ' + Object.keys(buildConfig.PROFILES));
      logger.error('Please set valid profile name ' +
                   'using --build-profile argument');
      process.exit(1);
    }

    if (profile.theme) {
      cli.argv['theme'] = profile.theme;
    }
    logger.log('Using multiconfiguration profile ' + p);
  }

  /**
   * Injecting profile parameters to tiapp.
   */
  cli.addHook('build.pre.construct', function(build, finished) {
    if (typeof profile['androidManifest'] === 'string' && build.customAndroidManifest) {
      var manifestFile = path.join(build.projectDir, profile['androidManifest']);
      if (fs.existsSync(manifestFile)) {
        var customManifest = build.customAndroidManifest.constructor.fromFilePathSync(manifestFile)
        build.customAndroidManifest.copyFromAndroidManifest(customManifest);
      }
    }
    if (profile['raw-config']) {
      extendObject(build, profile['raw-config'], 'config');
      if (profile['raw-config']['tiapp'] && profile['raw-config']['tiapp']['modules']) {
        build.validate(logger, config, cli)(function() {

          //Inject again, because it was rewritten on validation
          extendObject(build, profile['raw-config'], 'config');
          sync();
        });
      } else {
        sync();
      }
    } else {
      sync();
    }
    function sync() {
      if (!!profile.properties) {
        Object.keys(profile.properties).forEach(function(key) {
          var prop = build.tiapp.properties[key];
          var value = profile.properties[key];
          if (!prop) {
            var type;
            if (typeof value === 'boolean') type = 'bool';
            else if (typeof value === 'number') type = 'number';
            else type = 'string';
            prop = {type: type};
            build.tiapp.properties[key] = prop;
          }
          prop.value = profile.properties[key];
        });
      }

      build.tiapp.properties['ti.multiconfiguration.profile'] = {
        type: 'string',
        value: p
      };

      build.tiapp.id = profile.id;
      build.tiapp.name = profile.name;
      if (typeof buildConfig.VERSION !== 'undefined') {
        build.tiapp.version = buildConfig.VERSION;
      }

      if (typeof profile['android-theme'] !== 'undefined') {
        var themeId = profile['android-theme'];
        if (build.tiappAndroidManifest) {
          if (!build.tiappAndroidManifest.application) {
            build.tiappAndroidManifest.application = {};
          }
          build.tiappAndroidManifest.application.theme = '@style/Theme.Multiconfiguration.' + themeId;
        }
      }
      finished();
    }
  });
};
