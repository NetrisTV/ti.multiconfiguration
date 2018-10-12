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
var Q = require('q');
var _ = require('underscore');
var xml2js = require('xml2js');

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
   * Adding custom application theme using profile's 'android-theme' property.
   * @param {string} manifest Original manifest.
   * @return {Q.Promise} processed manifest.
   */
  function processAndroidManifest(manifest) {
    logger.log('Processing Android manifest');
    var themeId;
    if (typeof profile['android-theme'] !== 'undefined') {
      themeId = profile['android-theme'];
    }

    return Q.promise(function(resolve, reject) {
      if (!themeId) return resolve(manifest);

      var parser = new xml2js.Parser();
      var builder = new xml2js.Builder();

      parser.addListener('end', function(result) {
        var root = result['manifest'];
        root.application[0]['$']['android:theme'] =
          '@style/Theme.Multiconfiguration.' + themeId;

        var xml = builder.buildObject(result);
        resolve(xml);
      });

      parser.parseString(manifest, function(err, result) {
        if (err) return reject(err);
      });

    });
  }

  /**
   * Injecting profile parameters to tiapp.
   */
  cli.addHook('build.pre.construct', function(build, finished) {
    if (!!profile.properties) {
      Object.keys(profile.properties).forEach(function(key) {
        var prop = build.tiapp.properties[key];
        var value = profile.properties[key];
        if (!prop) {
          var type;
          if (_.isBoolean(value)) type = 'bool';
          else if (_.isNumber(value)) type = 'number';
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

    processAndroidManifest(build.tiapp.android.manifest).
      then(function(manifest) {
        build.tiapp.android.manifest = manifest;
        logger.log('Modified tiapp:');
        logger.log(JSON.stringify(build.tiapp));
        finished();
      });
  });
};
